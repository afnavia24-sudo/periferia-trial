import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { MODELO } from "../config";
import { detectarDatosBancarios } from "../lib/bancarios";
import { esConfirmacionExplicita, extraerCasoDeConfirmacion } from "../lib/confirmacion";
import { ToolError } from "../lib/errores";
import { DEFINICIONES, type Ejecutor } from "../tools";

export interface ClienteLLM {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface LlamadaHerramienta {
  nombre: string;
  input: Record<string, unknown>;
  resultado?: unknown;
  error?: { error: string; mensaje: string; detalle?: unknown };
  /** true si la guardia del orquestador impidió la ejecución. */
  bloqueada: boolean;
}

export interface RespuestaTurno {
  texto: string;
  llamadas: LlamadaHerramienta[];
  /** Caso cuya confirmación queda pendiente para el próximo mensaje del usuario. */
  confirmacion_pendiente: string | null;
}

export interface OpcionesAgente {
  cliente: ClienteLLM;
  ejecutor: Ejecutor;
  prompt?: string;
  modelo?: string;
  maxIteraciones?: number;
  maxTokens?: number;
}

export const RUTA_PROMPT = path.resolve("prompts/agente-proveedor.md");

/**
 * Orquestador del agente. Además del bucle de tool use, aplica guardias deterministas:
 *  - RN4: proveedor_simular_envio solo se ejecuta si (a) el turno anterior del agente pidió confirmación
 *    para ese caso, (b) el caso quedó apto en esta sesión y (c) el mensaje actual es una confirmación explícita.
 *  - RN2: valida el borrador de correo devuelto por proveedor_armar_paquete.
 * Las guardias no dependen de que el modelo siga el prompt.
 */
export class AgenteProveedor {
  private historial: Anthropic.MessageParam[] = [];
  private pendiente: string | null = null;
  private aptos = new Set<string>();
  private formatos = new Map<string, string>();
  private readonly prompt: string;

  constructor(private opts: OpcionesAgente) {
    this.prompt = opts.prompt ?? fs.readFileSync(RUTA_PROMPT, "utf8");
  }

  /** Para evals: precarga turnos previos y estado de sesión. */
  sembrar(turnos: { rol: "usuario" | "agente"; texto: string }[], estado?: { aptos?: string[] }) {
    this.historial = turnos.map((t) => ({ role: t.rol === "usuario" ? "user" : "assistant", content: t.texto }));
    for (const c of estado?.aptos ?? []) this.aptos.add(c);
    const ultimo = turnos.at(-1);
    if (ultimo?.rol === "agente") {
      const caso = extraerCasoDeConfirmacion(ultimo.texto);
      this.pendiente = caso && this.aptos.has(caso) ? caso : null;
    }
  }

  async enviar(mensajeUsuario: string): Promise<RespuestaTurno> {
    const confirmable = this.pendiente;
    this.pendiente = null; // la confirmación solo vale para el mensaje inmediatamente siguiente
    const confirmacion = esConfirmacionExplicita(mensajeUsuario);
    let envioConsumido = false;

    this.historial.push({ role: "user", content: mensajeUsuario });
    const llamadas: LlamadaHerramienta[] = [];
    const max = this.opts.maxIteraciones ?? 15;

    for (let i = 0; i < max; i++) {
      const respuesta = await this.opts.cliente.messages.create({
        model: this.opts.modelo ?? MODELO,
        max_tokens: this.opts.maxTokens ?? 4096,
        system: this.prompt,
        tools: DEFINICIONES,
        messages: this.historial,
      });
      this.historial.push({ role: "assistant", content: respuesta.content });

      const usos = respuesta.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (respuesta.stop_reason !== "tool_use" || usos.length === 0) {
        const texto = respuesta.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const casoPregunta = extraerCasoDeConfirmacion(texto);
        this.pendiente = casoPregunta && this.aptos.has(casoPregunta) && !envioConsumido ? casoPregunta : null;
        return { texto, llamadas, confirmacion_pendiente: this.pendiente };
      }

      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const uso of usos) {
        const input = (uso.input ?? {}) as Record<string, unknown>;
        const llamada: LlamadaHerramienta = { nombre: uso.name, input, bloqueada: false };
        try {
          if (uso.name === "proveedor_simular_envio") {
            const bloqueo = this.motivoBloqueoEnvio(String(input.caso ?? ""), confirmable, confirmacion, envioConsumido);
            if (bloqueo) {
              llamada.bloqueada = true;
              throw new ToolError("BLOQUEADO_POR_POLITICA", bloqueo);
            }
          }
          let resultado = await this.opts.ejecutor(uso.name, input);
          resultado = this.postProcesar(uso.name, input, resultado);
          if (uso.name === "proveedor_simular_envio") {
            envioConsumido = true;
            this.aptos.delete(String(input.caso));
          }
          llamada.resultado = resultado;
          resultados.push({ type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(resultado) });
        } catch (e) {
          const err = e instanceof ToolError ? e.toJSON() : { error: "ERROR_INTERNO", mensaje: (e as Error).message };
          llamada.error = err;
          resultados.push({ type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(err), is_error: true });
        }
        llamadas.push(llamada);
      }
      this.historial.push({ role: "user", content: resultados });
    }

    return {
      texto: "⛔ Se alcanzó el límite de iteraciones del agente sin una respuesta final. Revisa la traza.",
      llamadas,
      confirmacion_pendiente: null,
    };
  }

  private motivoBloqueoEnvio(
    caso: string,
    confirmable: string | null,
    confirmacion: { valida: boolean; motivo: string },
    envioConsumido: boolean,
  ): string | null {
    if (envioConsumido) return "Ya se ejecutó un envío en este turno; cada envío requiere su propia confirmación.";
    if (!confirmable) return "No se solicitó confirmación de envío en el turno inmediatamente anterior. Pide confirmación explícita al usuario.";
    if (confirmable !== caso) return `La confirmación pendiente corresponde al caso ${confirmable}, no a ${caso}.`;
    if (!confirmacion.valida) return `El mensaje del usuario no es una confirmación explícita (${confirmacion.motivo}). Vuelve a pedir confirmación.`;
    if (!this.aptos.has(caso)) return `El caso ${caso} no está apto para envío.`;
    return null;
  }

  /** Registra hechos de sesión y aplica la validación RN2 sobre la salida de las herramientas. */
  private postProcesar(nombre: string, input: Record<string, unknown>, resultado: unknown): unknown {
    const r = (resultado ?? {}) as Record<string, any>;
    const caso = String(input.caso ?? r.caso ?? "");
    if (nombre === "proveedor_leer_solicitud" && typeof r.formato === "string") this.formatos.set(caso, r.formato);

    if (nombre === "proveedor_armar_paquete") {
      const borrador = typeof r.borrador_correo === "string" ? r.borrador_correo : "";
      const deteccion = detectarDatosBancarios(borrador);
      const validacionHerramienta = r.validacion_borrador?.ok;
      const borradorOk = !deteccion.encontrado && validacionHerramienta !== false;
      const formato = this.formatos.get(caso);
      const apto =
        r.listo_para_firma === true &&
        typeof r.fecha_evaluacion === "string" &&
        borradorOk &&
        formato !== undefined &&
        formato !== "portal" &&
        r.apto_para_envio !== false;
      if (apto) this.aptos.add(caso);
      else this.aptos.delete(caso);
      return {
        ...r,
        ...(deteccion.encontrado ? { borrador_correo: "[OCULTO: el borrador contiene datos bancarios]" } : {}),
        validacion_orquestador: {
          borrador_sin_datos_bancarios: borradorOk,
          hallazgos: deteccion.hallazgos,
          fecha_evaluacion_presente: typeof r.fecha_evaluacion === "string",
          apto_para_envio: apto,
        },
      };
    }
    return resultado;
  }
}
