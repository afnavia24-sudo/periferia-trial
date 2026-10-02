import fs from "node:fs"
import path from "node:path"
import { ErrorLLM, type AdaptadorLLM, type Bloque, type Mensaje } from "../llm/adapter"
import { definiciones, ejecutar, registrarLog, type ResultadoEjecucion } from "../tools/registro"
import { evaluarConfirmacion } from "./confirmacion"
import type { LlamadaVisible, Sesion } from "./sesiones"

export interface OpcionesCiclo {
  adaptador: AdaptadorLLM
  sistema: string
  directory: string
  maxIteraciones: number
  maxTokensSesion: number
  /** Presupuesto global compartido por todas las sesiones del proceso. */
  presupuestoGlobal: { usados: number; maximo: number }
}

export interface RespuestaTurno {
  sessionId: string
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  error: string | null
}

const HERRAMIENTA_ENVIO = "proveedor_simular_envio"

/** Comportamiento en agent/prompt.md + conocimiento en src/knowledge/: se combinan al iniciar. */
export function cargarSistema(directory: string): string {
  const prompt = fs.readFileSync(path.join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = fs.readFileSync(path.join(directory, "src", "knowledge", "registro-proveedor.md"), "utf8")
  return `${prompt}\n\n---\n\n${conocimiento}`
}

const textoDe = (bloques: Bloque[]) => bloques.filter((b): b is Extract<Bloque, { tipo: "texto" }> => b.tipo === "texto").map((b) => b.texto).join("\n").trim()

export class Agente {
  constructor(private o: OpcionesCiclo) {}

  async turno(sesion: Sesion, mensaje: string): Promise<RespuestaTurno> {
    const pendienteAnterior = sesion.confirmacionPendiente
    sesion.confirmacionPendiente = null // CA3: la confirmación vale solo para el mensaje inmediatamente siguiente
    const confirmacion = evaluarConfirmacion(mensaje)
    const respaldo = sesion.mensajes.length
    const toolCalls: LlamadaVisible[] = []
    let pendienteNuevo: string | null = null
    let ultimoTexto = ""

    sesion.mensajes.push({ rol: "usuario", bloques: [{ tipo: "texto", texto: mensaje }] })
    sesion.historial.push({ ts: new Date().toISOString(), rol: "usuario", texto: mensaje, toolCalls: [], needsConfirmation: false })

    const cerrar = (reply: string, error: string | null = null): RespuestaTurno => {
      sesion.confirmacionPendiente = pendienteNuevo
      const r: RespuestaTurno = { sessionId: sesion.id, reply, toolCalls, needsConfirmation: pendienteNuevo !== null, error }
      sesion.historial.push({ ts: new Date().toISOString(), rol: error ? "sistema" : "agente", texto: reply, toolCalls, needsConfirmation: r.needsConfirmation })
      return r
    }

    for (let i = 0; i < this.o.maxIteraciones; i++) {
      if (sesion.tokensUsados >= this.o.maxTokensSesion) {
        sesion.mensajes.length = respaldo
        return cerrar("Esta sesión alcanzó su tope de tokens. Abre una sesión nueva para continuar.", "tope_tokens_sesion")
      }
      if (this.o.presupuestoGlobal.usados >= this.o.presupuestoGlobal.maximo) {
        sesion.mensajes.length = respaldo
        return cerrar("El servicio alcanzó su presupuesto de uso. Intenta más tarde.", "tope_tokens_global")
      }

      let respuesta
      try {
        respuesta = await this.o.adaptador.enviar(sesion.mensajes, definiciones(), { sistema: this.o.sistema })
      } catch (e) {
        sesion.mensajes.length = respaldo // CA5: la sesión sigue viva y coherente
        const msg = e instanceof ErrorLLM ? e.message : "Error inesperado al llamar al modelo."
        return cerrar(`⚠️ ${msg}${toolCalls.length ? " Las herramientas ya ejecutadas en este turno quedaron registradas." : ""}`, "error_llm")
      }

      const consumo = respuesta.uso.entrada + respuesta.uso.salida
      sesion.tokensUsados += consumo
      this.o.presupuestoGlobal.usados += consumo
      sesion.mensajes.push({ rol: "asistente", bloques: respuesta.bloques })
      ultimoTexto = textoDe(respuesta.bloques) || ultimoTexto

      const llamadas = respuesta.bloques.filter((b): b is Extract<Bloque, { tipo: "llamada" }> => b.tipo === "llamada")
      if (respuesta.fin !== "herramientas" || llamadas.length === 0) {
        return cerrar(textoDe(respuesta.bloques) || "(el modelo no devolvió texto)")
      }

      const resultados: Bloque[] = []
      for (const llamada of llamadas) {
        const { resultado, visible } = await this.ejecutarConGuardia(llamada.nombre, llamada.args, sesion, pendienteAnterior, confirmacion.valida, confirmacion.motivo)
        if (llamada.nombre === HERRAMIENTA_ENVIO) {
          const caso = String(llamada.args.caso ?? "")
          if (visible.ok) pendienteNuevo = null
          else if (visible.bloqueada || visible.resumen.startsWith("requiere confirmación explícita")) pendienteNuevo = caso
        }
        toolCalls.push(visible)
        resultados.push({ tipo: "resultado", idLlamada: llamada.id, contenido: resultado.resultado, esError: !resultado.ok })
      }
      sesion.mensajes.push({ rol: "usuario", bloques: resultados })
    }

    // CA1: tope de iteraciones. Se responde con lo que hay y lo que falta.
    const hechas = toolCalls.map((t) => `${t.nombre}: ${t.ok ? "ok" : "error"}`).join("; ") || "ninguna"
    sesion.mensajes.push({ rol: "asistente", bloques: [{ tipo: "texto", texto: "[tope de iteraciones alcanzado]" }] })
    return cerrar(
      `Alcancé el tope de ${this.o.maxIteraciones} pasos en este turno.\n\nLo que tengo: ${ultimoTexto || "sin respuesta parcial del modelo"}\n\nHerramientas ejecutadas: ${hechas}.\n\nLo que falta: escribe "continúa" para retomar.`,
      "tope_iteraciones",
    )
  }

  /** RN4: el envío solo se ejecuta si el turno anterior pidió confirmación para ese caso y el usuario confirmó explícitamente. */
  private async ejecutarConGuardia(nombre: string, args: Record<string, unknown>, sesion: Sesion, pendiente: string | null, confirmo: boolean, motivo: string): Promise<{ resultado: ResultadoEjecucion; visible: LlamadaVisible }> {
    const ctx = { directory: this.o.directory, sessionId: sesion.id }
    if (nombre === HERRAMIENTA_ENVIO && args.confirmado === true) {
      const caso = String(args.caso ?? "")
      const razon = pendiente !== caso
        ? "no se pidió confirmación para este caso en el turno anterior"
        : !confirmo ? motivo : null
      if (razon) {
        const error = `requiere confirmación explícita: ${razon}. Pregunta al usuario si confirma el envío simulado del caso ${caso} y termina el turno.`
        const resultado: ResultadoEjecucion = { nombre, args, ok: false, resumen: error, resultado: JSON.stringify({ ok: false, error }) }
        try {
          registrarLog(ctx, nombre, args, false, `BLOQUEADA por el backend: ${razon}`) // CA4: también queda en el log
        } catch {
          /* el log no debe tumbar el turno */
        }
        return { resultado, visible: { nombre, args, ok: false, resumen: error, bloqueada: true } }
      }
    }
    const resultado = await ejecutar(nombre, args, ctx)
    return { resultado, visible: { nombre, args, ok: resultado.ok, resumen: resultado.resumen, bloqueada: false } }
  }
}
