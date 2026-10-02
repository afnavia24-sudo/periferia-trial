import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Agente, cargarSistema } from "../src/agent/ciclo"
import { evaluarConfirmacion } from "../src/agent/confirmacion"
import { Sesiones } from "../src/agent/sesiones"
import { ErrorLLM } from "../src/llm/adapter"
import { AdaptadorFalso, proyectoTemporal, responderTexto, usarHerramienta } from "./ayuda"

let dir: string
let adaptador: AdaptadorFalso
let agente: Agente
const sesiones = new Sesiones()
const envio = (dir: string) => path.join(dir, "out/ec-corp-andina/ENVIO-SIMULADO.md")

function crearAgente(opciones: Partial<{ maxIteraciones: number; maxTokensSesion: number }> = {}) {
  agente = new Agente({ adaptador, sistema: cargarSistema(dir), directory: dir, maxIteraciones: opciones.maxIteraciones ?? 25, maxTokensSesion: opciones.maxTokensSesion ?? 1e6, presupuestoGlobal: { usados: 0, maximo: 1e7 } })
}

async function procesarCaso(sesion = sesiones.obtenerOCrear()) {
  adaptador.agregar(
    usarHerramienta("proveedor_leer_solicitud", { caso: "ec-corp-andina" }),
    usarHerramienta("proveedor_mapear_campos", { caso: "ec-corp-andina", campos: [] }),
    usarHerramienta("proveedor_generar_formulario", { caso: "ec-corp-andina" }),
    usarHerramienta("proveedor_armar_paquete", { caso: "ec-corp-andina" }),
    responderTexto("Resumen… ¿Quieres que prepare el envío?"),
  )
  return { sesion, r: await agente.turno(sesion, "Procesa el caso ec-corp-andina. No envíes nada todavía.") }
}

beforeEach(() => {
  dir = proyectoTemporal()
  adaptador = new AdaptadorFalso()
  crearAgente()
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("ciclo del agente", () => {
  it("el system prompt combina comportamiento (agent/prompt.md) y conocimiento (src/knowledge)", () => {
    const s = cargarSistema(dir)
    expect(s).toContain("Reglas que no se rompen")
    expect(s).toContain("Identificador tributario por país")
  })
  it("ejecuta herramientas, las muestra y no pide confirmación si no hubo intento de envío", async () => {
    const { r } = await procesarCaso()
    expect(r.toolCalls.map((t) => t.nombre)).toEqual(["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"])
    expect(r.toolCalls.every((t) => t.ok)).toBe(true)
    expect(r.needsConfirmation).toBe(false)
    expect(fs.existsSync(envio(dir))).toBe(false)
  })
  it("CA1: respeta el tope de iteraciones y responde con lo que tiene", async () => {
    crearAgente({ maxIteraciones: 2 })
    adaptador.agregar(usarHerramienta("proveedor_leer_solicitud", { caso: "ec-corp-andina" }), usarHerramienta("proveedor_leer_solicitud", { caso: "ec-corp-andina" }))
    const r = await agente.turno(sesiones.obtenerOCrear(), "procesa")
    expect(r.error).toBe("tope_iteraciones")
    expect(r.reply).toContain("tope de 2 pasos")
    expect(adaptador.llamadas).toHaveLength(2)
  })
  it("CA5: un error del proveedor se explica y la sesión sigue viva", async () => {
    const sesion = sesiones.obtenerOCrear()
    adaptador.agregar(new ErrorLLM("El modelo no respondió en 60 s. Intenta de nuevo."))
    const r = await agente.turno(sesion, "hola")
    expect(r.reply).toContain("no respondió")
    expect(sesion.mensajes).toHaveLength(0)
    adaptador.agregar(responderTexto("Hola, ¿qué caso procesamos?"))
    expect((await agente.turno(sesion, "hola")).reply).toContain("qué caso")
  })
  it("tope de tokens por sesión", async () => {
    crearAgente({ maxTokensSesion: 50 })
    const sesion = sesiones.obtenerOCrear()
    adaptador.agregar(responderTexto("uno"))
    await agente.turno(sesion, "hola")
    expect((await agente.turno(sesion, "otra vez")).error).toBe("tope_tokens_sesion")
  })
})

describe("RN4 / CA3 confirmación humana", () => {
  it('flujo del PRD: "envía" pide confirmación y "sí, confirmo" produce solo ENVIO-SIMULADO.md', async () => {
    const { sesion } = await procesarCaso()
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: false }), responderTexto("¿Confirmas el envío simulado del caso ec-corp-andina?"))
    const pide = await agente.turno(sesion, "envía")
    expect(pide.needsConfirmation).toBe(true)
    expect(fs.existsSync(envio(dir))).toBe(false)
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }), responderTexto("Listo."))
    const ok = await agente.turno(sesion, "Sí, confirmo el envío")
    expect(ok.toolCalls[0]).toMatchObject({ ok: true, bloqueada: false })
    expect(ok.needsConfirmation).toBe(false)
    expect(fs.existsSync(envio(dir))).toBe(true)
  })
  it("bloquea confirmado:true si no se pidió confirmación en el turno anterior, aunque el usuario diga sí", async () => {
    const { sesion } = await procesarCaso()
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }), responderTexto("¿Confirmas?"))
    const r = await agente.turno(sesion, "Sí, envíalo")
    expect(r.toolCalls[0]).toMatchObject({ bloqueada: true, ok: false })
    expect(r.needsConfirmation).toBe(true)
    expect(fs.existsSync(envio(dir))).toBe(false)
    expect(fs.readFileSync(path.join(dir, "out/log.jsonl"), "utf8")).toContain("BLOQUEADA")
  })
  it.each(["ok", "dale", "listo", "envía", "¿ya lo enviaste?", "sí, pero cambia el correo", "no"])("bloquea respuestas no explícitas: %s", async (mensaje) => {
    const { sesion } = await procesarCaso()
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: false }), responderTexto("¿Confirmas?"))
    await agente.turno(sesion, "envía")
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }), responderTexto("..."))
    const r = await agente.turno(sesion, mensaje)
    expect(r.toolCalls[0]?.bloqueada).toBe(true)
    expect(fs.existsSync(envio(dir))).toBe(false)
  })
  it("la confirmación caduca si hay un turno intermedio", async () => {
    const { sesion } = await procesarCaso()
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: false }), responderTexto("¿Confirmas?"))
    await agente.turno(sesion, "envía")
    adaptador.agregar(responderTexto("La Cámara vence el 30 de septiembre."))
    await agente.turno(sesion, "¿cuándo vence la cámara?")
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }), responderTexto("..."))
    expect((await agente.turno(sesion, "sí, confirmo")).toolCalls[0]?.bloqueada).toBe(true)
  })
  it("la confirmación es para un caso específico", async () => {
    const { sesion } = await procesarCaso()
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: false }), responderTexto("¿Confirmas?"))
    await agente.turno(sesion, "envía")
    adaptador.agregar(usarHerramienta("proveedor_simular_envio", { caso: "co-industrias-delta", confirmado: true }), responderTexto("..."))
    expect((await agente.turno(sesion, "sí, confirmo")).toolCalls[0]?.bloqueada).toBe(true)
  })
})

describe("evaluarConfirmacion", () => {
  it.each(["Sí", "sí, confirmo el envío", "Confirmo", "Autorizo el envío", "si, procede"])("válida: %s", (m) => expect(evaluarConfirmacion(m).valida).toBe(true))
  it.each(["ok", "dale", "listo", "envía", "👍", "¿sí?", "no", "no envíes nada", "sí, pero antes revisa el RUT"])("inválida: %s", (m) => expect(evaluarConfirmacion(m).valida).toBe(false))
})
