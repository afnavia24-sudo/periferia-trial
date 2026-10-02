import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { leerConfig } from "../src/config"
import { crearServidor } from "../src/server"
import { AdaptadorFalso, responderTexto } from "./ayuda"

const adaptador = new AdaptadorFalso()
const servidor = crearServidor(adaptador, leerConfig({ ACCESS_KEY: "clave-demo" }))
let base = ""

beforeAll(async () => {
  await new Promise<void>((r) => servidor.listen(0, r))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => servidor.close(() => r())))

describe("API", () => {
  it("GET /api/health no expone claves y lista los casos", async () => {
    const r = await fetch(`${base}/api/health`).then((x) => x.json())
    expect(r).toMatchObject({ ok: true, provider: "falso", model: "guion", requiresAccessKey: true, sessionStore: "memoria" })
    expect(r.casos).toEqual(["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"])
    expect(JSON.stringify(r)).not.toContain("clave-demo")
  })
  it("protege la API con ACCESS_KEY", async () => {
    expect((await fetch(`${base}/api/chat`, { method: "POST", body: "{}" })).status).toBe(401)
  })
  it("POST /api/chat y GET /api/sessions/:id", async () => {
    adaptador.agregar(responderTexto("Hola, ¿qué caso procesamos?"))
    const headers = { "x-access-key": "clave-demo", "content-type": "application/json" }
    const chat = await fetch(`${base}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "hola" }) }).then((x) => x.json())
    expect(chat).toMatchObject({ reply: "Hola, ¿qué caso procesamos?", toolCalls: [], needsConfirmation: false })
    const sesion = await fetch(`${base}/api/sessions/${chat.sessionId}`, { headers }).then((x) => x.json())
    expect(sesion.historial.map((h: { rol: string }) => h.rol)).toEqual(["usuario", "agente"])
  })
  it("valida el cuerpo y sirve el front", async () => {
    const headers = { "x-access-key": "clave-demo" }
    expect((await fetch(`${base}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "" }) })).status).toBe(400)
    expect(await fetch(`${base}/`).then((x) => x.text())).toContain("Registro como proveedor")
  })
})

describe("configuración", () => {
  it("acepta el .env.example copiado tal cual (variables vacías = no definidas)", () => {
    const config = leerConfig({ FECHA_EJECUCION: "", ACCESS_KEY: "", MAX_ITERACIONES: "" })
    expect(config.FECHA_EJECUCION).toBeUndefined()
    expect(config.ACCESS_KEY).toBeUndefined()
    expect(config.MAX_ITERACIONES).toBe(25)
  })
})
