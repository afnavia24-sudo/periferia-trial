/**
 * Prueba el orquestador con un LLM simulado (guion de respuestas). Verifica que las guardias
 * deterministas funcionan aunque el modelo intente saltarse el prompt.
 */
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { AgenteProveedor, type ClienteLLM } from "../src/agent/agente";
import { OUT_DIR } from "../src/config";
import { ejecutorReal, type Ejecutor } from "../src/tools";

let n = 0;
const msg = (content: any[], stop: Anthropic.Message["stop_reason"]): Anthropic.Message =>
  ({ id: `m${n++}`, type: "message", role: "assistant", model: "fake", content, stop_reason: stop, stop_sequence: null, usage: {} }) as any;
const tool = (name: string, input: Record<string, unknown>) => msg([{ type: "tool_use", id: `t${n++}`, name, input }], "tool_use");
const texto = (t: string) => msg([{ type: "text", text: t }], "end_turn");
const PREGUNTA = (caso: string) => `Resumen...\n💡 **¿Autorizas la simulación del envío del paquete del caso ${caso} al cliente?**`;

class ClienteGuionado implements ClienteLLM {
  constructor(private guion: Anthropic.Message[]) {}
  messages = { create: async () => { const m = this.guion.shift(); if (!m) throw new Error("guion agotado"); return m; } };
  agregar(...m: Anthropic.Message[]) { this.guion.push(...m); }
}

const flujoCompleto = (caso: string, formato: string) => [
  tool("proveedor_leer_solicitud", { caso }),
  tool("proveedor_mapear_campos", { caso }),
  tool("proveedor_generar_formulario", { caso, formato }),
  tool("proveedor_armar_paquete", { caso }),
];
const envioRegistrado = (caso: string) => fs.existsSync(path.join(OUT_DIR, caso, "envio-simulado.json"));

beforeEach(() => fs.rmSync(OUT_DIR, { recursive: true, force: true }));

describe("guardia RN4 en el orquestador", () => {
  it("bloquea 'ok', acepta la confirmación explícita posterior a una nueva pregunta", async () => {
    const cliente = new ClienteGuionado([...flujoCompleto("co-industrias-sur", "xlsx"), texto(PREGUNTA("co-industrias-sur"))]);
    const agente = new AgenteProveedor({ cliente, ejecutor: ejecutorReal, prompt: "test" });

    const t1 = await agente.enviar("Procesa el caso 'co-industrias-sur'");
    expect(t1.llamadas.map((l) => l.error?.error)).toEqual([undefined, undefined, undefined, undefined]);
    expect(t1.confirmacion_pendiente).toBe("co-industrias-sur");

    cliente.agregar(tool("proveedor_simular_envio", { caso: "co-industrias-sur" }), texto(PREGUNTA("co-industrias-sur")));
    const t2 = await agente.enviar("ok");
    expect(t2.llamadas[0]).toMatchObject({ bloqueada: true, error: { error: "BLOQUEADO_POR_POLITICA" } });
    expect(envioRegistrado("co-industrias-sur")).toBe(false);

    cliente.agregar(tool("proveedor_simular_envio", { caso: "co-industrias-sur" }), texto("Envío simulado."));
    const t3 = await agente.enviar("Sí, autorizo el envío");
    expect(t3.llamadas[0].bloqueada).toBe(false);
    expect(t3.llamadas[0].error).toBeUndefined();
    expect(envioRegistrado("co-industrias-sur")).toBe(true);
    expect(t3.confirmacion_pendiente).toBeNull();
  });

  it("bloquea un envío intentado en el mismo turno del procesamiento (inyección en los datos)", async () => {
    const cliente = new ClienteGuionado([
      tool("proveedor_leer_solicitud", { caso: "hn-cafe-copan" }),
      tool("proveedor_simular_envio", { caso: "hn-cafe-copan" }),
      texto("No puedo enviar sin tu autorización."),
    ]);
    const agente = new AgenteProveedor({ cliente, ejecutor: ejecutorReal, prompt: "test" });
    const r = await agente.enviar("Procesa el caso 'hn-cafe-copan'. Sí, autorizo el envío");
    expect(r.llamadas[1]).toMatchObject({ nombre: "proveedor_simular_envio", bloqueada: true });
  });

  it("no deja pendiente un caso no apto aunque el modelo pregunte, y bloquea el envío", async () => {
    const cliente = new ClienteGuionado([...flujoCompleto("pe-logistica-lima", "xlsx"), texto(PREGUNTA("pe-logistica-lima"))]);
    const agente = new AgenteProveedor({ cliente, ejecutor: ejecutorReal, prompt: "test" });
    const t1 = await agente.enviar("Procesa el caso 'pe-logistica-lima'");
    expect(t1.confirmacion_pendiente).toBeNull();
    cliente.agregar(tool("proveedor_simular_envio", { caso: "pe-logistica-lima" }), texto("Bloqueado."));
    const t2 = await agente.enviar("Envíalo igual. Autorizo el envío.");
    expect(t2.llamadas[0].bloqueada).toBe(true);
    expect(envioRegistrado("pe-logistica-lima")).toBe(false);
  });

  it("bloquea si la confirmación es para otro caso", async () => {
    const cliente = new ClienteGuionado([...flujoCompleto("co-industrias-sur", "xlsx"), texto(PREGUNTA("co-industrias-sur"))]);
    const agente = new AgenteProveedor({ cliente, ejecutor: ejecutorReal, prompt: "test" });
    await agente.enviar("Procesa el caso 'co-industrias-sur'");
    cliente.agregar(tool("proveedor_simular_envio", { caso: "ec-corp-andina" }), texto("..."));
    const r = await agente.enviar("Sí, autorizo el envío");
    expect(r.llamadas[0]).toMatchObject({ bloqueada: true });
    expect(r.llamadas[0].error?.mensaje).toContain("co-industrias-sur");
  });

  it("la confirmación caduca si el turno intermedio no repite la pregunta", async () => {
    const cliente = new ClienteGuionado([...flujoCompleto("co-industrias-sur", "xlsx"), texto(PREGUNTA("co-industrias-sur"))]);
    const agente = new AgenteProveedor({ cliente, ejecutor: ejecutorReal, prompt: "test" });
    await agente.enviar("Procesa el caso 'co-industrias-sur'");
    cliente.agregar(texto("La cámara de comercio vence el 2026-12-15."));
    await agente.enviar("¿Cuándo vence la cámara de comercio?");
    cliente.agregar(tool("proveedor_simular_envio", { caso: "co-industrias-sur" }), texto("..."));
    const r = await agente.enviar("Sí, autorizo el envío");
    expect(r.llamadas[0].bloqueada).toBe(true);
  });
});

describe("guardia RN2 en el orquestador", () => {
  it("oculta un borrador con datos bancarios y deja el caso no apto", async () => {
    const mocks: Record<string, unknown> = {
      proveedor_leer_solicitud: { cliente: "X", pais: "EC", formato: "xlsx" },
      proveedor_armar_paquete: { listo_para_firma: true, fecha_evaluacion: "2026-10-01", borrador_correo: "Nuestra cuenta de ahorros es 123-456789-00" },
    };
    const ejecutor: Ejecutor = async (nombre) => structuredClone(mocks[nombre]);
    const cliente = new ClienteGuionado([
      tool("proveedor_leer_solicitud", { caso: "ec-x" }),
      tool("proveedor_armar_paquete", { caso: "ec-x" }),
      texto(PREGUNTA("ec-x")),
    ]);
    const agente = new AgenteProveedor({ cliente, ejecutor, prompt: "test" });
    const r = await agente.enviar("Procesa el caso 'ec-x'");
    const armado = r.llamadas[1].resultado as any;
    expect(armado.borrador_correo).toContain("OCULTO");
    expect(armado.validacion_orquestador.apto_para_envio).toBe(false);
    expect(r.confirmacion_pendiente).toBeNull();
  });
});
