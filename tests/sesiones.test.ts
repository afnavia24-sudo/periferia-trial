import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AlmacenMemoria, AlmacenRedis, crearAlmacen } from "../src/agent/sesiones"
import { relativa, rutas } from "../src/tools/lib/rutas"

/** Upstash falso: implementa GET, SET (con NX) y DEL sobre un Map, con la misma forma de respuesta. */
function upstashFalso() {
  const datos = new Map<string, string>()
  const llamadas: string[][] = []
  const fetchFalso = (async (_url: string, init: RequestInit) => {
    const [cmd, clave = "", valor = "", ...resto] = JSON.parse(String(init.body)) as string[]
    llamadas.push([cmd ?? "", clave, ...resto])
    let result: unknown = null
    if (cmd === "GET") result = datos.get(clave) ?? null
    if (cmd === "DEL") result = Number(datos.delete(clave))
    if (cmd === "SET") {
      if (!(resto.includes("NX") && datos.has(clave))) {
        datos.set(clave, valor)
        result = "OK"
      }
    }
    return new Response(JSON.stringify({ result }), { status: 200 })
  }) as typeof fetch
  return { datos, llamadas, fetchFalso }
}

describe("AlmacenRedis", () => {
  it("guarda la sesión y otra instancia la recupera con la confirmación pendiente", async () => {
    const { fetchFalso, llamadas } = upstashFalso()
    const a = new AlmacenRedis("https://redis.example", "token", { fetch: fetchFalso })
    const s = await a.obtenerOCrear()
    s.confirmacionPendiente = "ec-corp-andina"
    s.ocupada = true
    await a.guardar(s)

    const b = new AlmacenRedis("https://redis.example", "token", { fetch: fetchFalso })
    const recuperada = await b.obtener(s.id)
    expect(recuperada).toMatchObject({ id: s.id, confirmacionPendiente: "ec-corp-andina", ocupada: false })
    expect(llamadas.find((l) => l[0] === "SET")).toContain("EX")
  })

  it("bloquea un segundo mensaje concurrente sobre la misma sesión", async () => {
    const { fetchFalso } = upstashFalso()
    const a = new AlmacenRedis("https://redis.example", "token", { fetch: fetchFalso })
    expect(await a.tomar("sesion-123")).toBe(true)
    expect(await a.tomar("sesion-123")).toBe(false)
    await a.soltar("sesion-123")
    expect(await a.tomar("sesion-123")).toBe(true)
  })

  it("propaga los errores de Redis", async () => {
    const fetchFalla = (async () => new Response(JSON.stringify({ error: "WRONGPASS" }), { status: 401 })) as typeof fetch
    await expect(new AlmacenRedis("https://redis.example", "x", { fetch: fetchFalla }).obtener("sesion-123")).rejects.toThrow("WRONGPASS")
  })
})

describe("crearAlmacen", () => {
  it("usa Redis solo si están la URL y el token", () => {
    expect(crearAlmacen({}).tipo).toBe("memoria")
    expect(crearAlmacen({ KV_REST_API_URL: "https://r" }).tipo).toBe("memoria")
    expect(crearAlmacen({ KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t" }).tipo).toBe("redis")
    expect(crearAlmacen({ UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" }).tipo).toBe("redis")
  })

  it("en memoria también bloquea mensajes concurrentes", async () => {
    const m = new AlmacenMemoria()
    const s = await m.obtenerOCrear()
    expect(await m.tomar(s.id)).toBe(true)
    expect(await m.tomar(s.id)).toBe(false)
    await m.soltar(s.id)
    expect(await m.tomar(s.id)).toBe(true)
  })
})

describe("OUT_DIR", () => {
  afterEach(() => {
    delete process.env.OUT_DIR
  })

  it("escribe fuera del proyecto pero reporta las rutas como out/...", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reto01-out-"))
    process.env.OUT_DIR = tmp
    const ctx = { directory: "/var/task", sessionId: "t" }
    expect(rutas(ctx).out).toBe(tmp)
    expect(relativa(ctx, path.join(tmp, "ec-corp-andina", "paquete"))).toBe("out/ec-corp-andina/paquete")
    expect(relativa(ctx, "/var/task/fixtures/reto-01")).toBe("fixtures/reto-01")
  })
})
