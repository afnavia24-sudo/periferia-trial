import fs from "node:fs"
import { afterAll, describe, expect, it } from "vitest"
import { ejecutarDemo } from "../demo"
import { proyectoTemporal } from "./ayuda"

const dir = proyectoTemporal()
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("demo.ts (§6.6)", () => {
  it("corre todos los casos sin modelo y es determinista", async () => {
    process.env.FECHA_EJECUCION = "2026-10-02"
    const a = await ejecutarDemo(dir)
    const b = await ejecutarDemo(dir)
    delete process.env.FECHA_EJECUCION
    expect(a).toEqual(b)
    expect(a.map((r) => r.caso)).toEqual(["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"])
    expect(a.every((r) => r.errores.length === 0 && r.envio_sin_confirmacion.startsWith("bloqueado"))).toBe(true)
  })
})
