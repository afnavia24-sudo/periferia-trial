import fs from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as proveedor from "../src/tools/proveedor"
import { definiciones } from "../src/tools/registro"
import { herramienta, proyectoTemporal } from "./ayuda"

let dir: string
const lista = (v: unknown) => (v as { etiqueta: string }[]).map((x) => x.etiqueta)

beforeEach(() => {
  dir = proyectoTemporal()
  process.env.FECHA_EJECUCION = "2026-10-02"
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  delete process.env.FECHA_EJECUCION
})

async function procesar(caso: string) {
  const leer = await herramienta(dir, "leer_solicitud", { caso })
  const mapeo = await herramienta(dir, "mapear_campos", { caso, campos: leer.data?.campos ?? [] })
  const gen = await herramienta(dir, "generar_formulario", { caso })
  const paq = await herramienta(dir, "armar_paquete", { caso })
  return { leer, mapeo, gen, paq }
}

describe("contrato de herramientas (§6.2)", () => {
  it("cada herramienta tiene exactamente description, args y execute, y se expone como proveedor_<export>", () => {
    for (const h of Object.values(proveedor)) expect(Object.keys(h).sort()).toEqual(["args", "description", "execute"])
    expect(definiciones().map((d) => d.nombre).sort()).toEqual([
      "proveedor_armar_paquete", "proveedor_generar_formulario", "proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_simular_envio",
    ])
  })
  it("cada argumento tiene descripción para el modelo", () => {
    for (const d of definiciones()) {
      const props = (d.parametros as { properties: Record<string, { description?: string }> }).properties
      for (const [k, v] of Object.entries(props)) expect(v.description, `${d.nombre}.${k}`).toBeTruthy()
    }
  })
  it("argumentos inválidos devuelven { ok: false } sin lanzar", async () => {
    expect(await herramienta(dir, "leer_solicitud", { caso: 42 })).toMatchObject({ ok: false, error: expect.stringContaining("argumentos inválidos") })
  })
  it("caso inexistente y path traversal devuelven error claro", async () => {
    expect((await herramienta(dir, "leer_solicitud", { caso: "xx-no-existe" })).error).toContain("no existe")
    expect((await herramienta(dir, "leer_solicitud", { caso: "../../etc" })).error).toContain("inválido")
  })
})

describe("HU-1 leer solicitud", () => {
  it("devuelve país, cliente, formato, campos y soportes", async () => {
    const r = await herramienta(dir, "leer_solicitud", { caso: "ec-corp-andina" })
    expect(r.data).toMatchObject({ pais: "EC", formato: "pdf", cliente: "Corporación Andina de Servicios S.A.", identificador_del_pais: "RUC" })
    expect(r.data?.campos).toHaveLength(15)
    expect(r.data?.soportes).toContain("certificado_cumplimiento_tributario")
  })
  it("reporta el identificador del país como requiere_confirmacion con propuesta", async () => {
    const r = await herramienta(dir, "leer_solicitud", { caso: "hn-agroexport-sula" })
    expect(r.data?.requiere_confirmacion).toEqual([expect.objectContaining({ etiqueta: "RTN", propuesta: "RTN" })])
  })
  it("plantilla corrupta: avisa y continúa con lo que puede (HU-5)", async () => {
    fs.writeFileSync(path.join(dir, "fixtures/reto-01/casos/co-industrias-delta/plantilla-celdas.json"), "{ esto no es json")
    const leer = await herramienta(dir, "leer_solicitud", { caso: "co-industrias-delta" })
    expect(leer.ok).toBe(true)
    expect(leer.data?.campos).toEqual([])
    expect(String(leer.data?.advertencias)).toContain("corrupto")
    expect(leer.data?.soportes).toHaveLength(4)
    expect((await herramienta(dir, "generar_formulario", { caso: "co-industrias-delta" })).error).toContain("corrupto")
    const paq = await herramienta(dir, "armar_paquete", { caso: "co-industrias-delta" })
    expect(paq.ok).toBe(true)
    expect(paq.data?.listo_para_firma).toBe(false)
  })
})

describe("HU-2 mapear campos", () => {
  it("co-industrias-delta: los 17 campos quedan llenos con su ruta del maestro", async () => {
    const { mapeo } = await procesar("co-industrias-delta")
    expect(lista(mapeo.data?.llenos)).toHaveLength(17)
    expect(mapeo.data?.llenos).toContainEqual(expect.objectContaining({ etiqueta: "Correo electrónico", ruta: "contacto_comercial.email", confianza: 1 }))
  })
  it("nunca inventa: los campos sin fuente quedan faltantes", async () => {
    expect(lista((await procesar("ec-corp-andina")).mapeo.data?.faltantes)).toEqual(["Número de contribuyente especial"])
    expect(lista((await procesar("hn-agroexport-sula")).mapeo.data?.faltantes)).toEqual(["Referencias comerciales"])
  })
  it.each([["ec-corp-andina", "RUC"], ["hn-agroexport-sula", "RTN"], ["pa-logistica-istmo", "RUC"]])("RN1 %s: NIT asignado a %s y por confirmar", async (caso, etiqueta) => {
    const { mapeo } = await procesar(caso)
    expect(mapeo.data?.requiere_confirmacion).toEqual([expect.objectContaining({ etiqueta, valor: "900123456", motivo: expect.stringContaining("identificador extranjero") })])
  })
  it("etiqueta genérica en CO: requiere confirmación proponiendo NIT", async () => {
    const r = await herramienta(dir, "mapear_campos", { caso: "co-industrias-delta", campos: ["Identificación tributaria"] })
    expect(r.data?.requiere_confirmacion).toEqual([expect.objectContaining({ motivo: expect.stringContaining("equivalente es NIT") })])
  })
  it("enmascara la cuenta y la cédula hacia el chat", async () => {
    const { mapeo } = await procesar("co-industrias-delta")
    const valor = (e: string) => (mapeo.data?.llenos as { etiqueta: string; valor: string }[]).find((x) => x.etiqueta === e)?.valor
    expect(valor("Número de cuenta")).toBe("****2345")
    expect(valor("Cédula del representante legal")).toBe("****5123")
  })
})

describe("HU-3 generar formulario", () => {
  it("xlsx: cada etiqueta y valor en la hoja y celda de la plantilla", async () => {
    await procesar("co-industrias-delta")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path.join(dir, "out/co-industrias-delta/formulario.xlsx"))
    const plantilla = JSON.parse(fs.readFileSync(path.join(dir, "fixtures/reto-01/casos/co-industrias-delta/plantilla-celdas.json"), "utf8")) as { hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }[]
    for (const p of plantilla) expect(wb.getWorksheet(p.hoja)?.getCell(p.celda_etiqueta).value).toBe(p.etiqueta)
    expect(wb.getWorksheet("Datos Proveedor")?.getCell("C3").value).toBe("Periferia IT Group S.A.S.")
    expect(wb.getWorksheet("Datos Bancarios")?.getCell("C5").value).toBe("03100012345")
  })
  it("xlsx: el faltante queda vacío y marcado; los números se escriben como números", async () => {
    await procesar("hn-agroexport-sula")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path.join(dir, "out/hn-agroexport-sula/formulario.xlsx"))
    const hoja = wb.getWorksheet("Registro")
    expect(hoja?.getCell("B12").value).toBeNull()
    expect(String(hoja?.getCell("B12").note)).toContain("FALTANTE")
    expect(hoja?.getCell("B10").value).toBe(480)
    expect(String(hoja?.getCell("B11").note)).toContain("COP")
  })
  it("pdf: genera un PDF válido", async () => {
    const { gen } = await procesar("ec-corp-andina")
    expect(gen.data).toMatchObject({ ruta: "out/ec-corp-andina/formulario.pdf", formato: "pdf", escritos: 14 })
    expect(fs.readFileSync(path.join(dir, "out/ec-corp-andina/formulario.pdf")).subarray(0, 5).toString()).toBe("%PDF-")
  })
  it("portal: formato no soportado y valores listos para copiar", async () => {
    const { gen } = await procesar("pa-logistica-istmo")
    expect(gen.data).toMatchObject({ ruta: "out/pa-logistica-istmo/valores-portal.md", formato: "portal", aviso: expect.stringContaining("formato no soportado") })
    expect(fs.readFileSync(path.join(dir, "out/pa-logistica-istmo/valores-portal.md"), "utf8")).toContain("| SWIFT | COLOCOBM |")
  })
  it("los valores salen del maestro aunque el mapeo recibido diga otra cosa", async () => {
    await herramienta(dir, "leer_solicitud", { caso: "hn-agroexport-sula" })
    const r = await herramienta(dir, "generar_formulario", { caso: "hn-agroexport-sula", mapeo: { llenos: [{ etiqueta: "Referencias comerciales" }] } })
    expect(r.data?.discrepancias).toEqual([expect.stringContaining("Referencias comerciales")])
    expect(r.data?.vacios).toContain("Referencias comerciales")
  })
})

describe("HU-4 paquete y RN3", () => {
  it("con la fecha del reto, la Cámara de Comercio vencida bloquea la firma", async () => {
    const { paq } = await procesar("co-industrias-delta")
    expect(paq.data).toMatchObject({ ruta: "out/co-industrias-delta/paquete/", listo_para_firma: false })
    expect(paq.data?.checklist).toMatchObject({ vencidos: ["camara_comercio"], ausentes: [] })
  })
  it("antes del vencimiento, co-industrias-delta queda listo para firma", async () => {
    process.env.FECHA_EJECUCION = "2026-09-15"
    const { paq } = await procesar("co-industrias-delta")
    expect(paq.data?.listo_para_firma).toBe(true)
    expect(paq.data?.archivos).toEqual(["borrador-correo.md", "camara-comercio-2026-08.txt", "certificacion-bancaria-2026-08.txt", "checklist.md", "estados-financieros-2025.txt", "formulario.xlsx", "rut-2026.txt"])
  })
  it("el soporte vence el mismo día: sigue vigente", async () => {
    process.env.FECHA_EJECUCION = "2026-09-30"
    expect((await procesar("co-industrias-delta")).paq.data?.listo_para_firma).toBe(true)
  })
  it("soporte exigido ausente bloquea; campo faltante no", async () => {
    process.env.FECHA_EJECUCION = "2026-09-15"
    const { paq } = await procesar("ec-corp-andina")
    expect(paq.data?.checklist).toMatchObject({ ausentes: ["certificado_cumplimiento_tributario"], campos_faltantes: ["Número de contribuyente especial"] })
    expect(paq.data?.listo_para_firma).toBe(false)
  })
  it("RN2: el borrador nunca contiene datos bancarios aunque el formulario los pida", async () => {
    await procesar("co-industrias-delta")
    const borrador = fs.readFileSync(path.join(dir, "out/co-industrias-delta/paquete/borrador-correo.md"), "utf8")
    for (const v of ["03100012345", "COLOCOBM", "Bancolombia"]) expect(borrador).not.toContain(v)
  })
  it("RN5: cada ejecución deja log por caso y log global", async () => {
    await procesar("ec-corp-andina")
    const lineas = fs.readFileSync(path.join(dir, "out/ec-corp-andina/log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lineas).toHaveLength(4)
    expect(Object.keys(lineas[0] ?? {}).sort()).toEqual(["herramienta", "ok", "resumen", "ts"])
    expect(fs.existsSync(path.join(dir, "out/log.jsonl"))).toBe(true)
  })
})

describe("RN4 simular envío", () => {
  it("sin confirmación devuelve el error exacto del contrato", async () => {
    await procesar("ec-corp-andina")
    expect(await herramienta(dir, "simular_envio", { caso: "ec-corp-andina", confirmado: false })).toEqual({ ok: false, error: "requiere confirmación explícita" })
    expect(fs.existsSync(path.join(dir, "out/ec-corp-andina/ENVIO-SIMULADO.md"))).toBe(false)
  })
  it("con confirmación escribe solo ENVIO-SIMULADO.md y no permite duplicar", async () => {
    await procesar("ec-corp-andina")
    const antes = fs.readdirSync(path.join(dir, "out/ec-corp-andina")).sort()
    expect((await herramienta(dir, "simular_envio", { caso: "ec-corp-andina", confirmado: true })).data).toMatchObject({ ruta: "out/ec-corp-andina/ENVIO-SIMULADO.md" })
    expect(fs.readdirSync(path.join(dir, "out/ec-corp-andina")).sort()).toEqual([...antes, "ENVIO-SIMULADO.md"].sort())
    expect((await herramienta(dir, "simular_envio", { caso: "ec-corp-andina", confirmado: true })).ok).toBe(false)
  })
  it("exige el paquete armado", async () => {
    expect((await herramienta(dir, "simular_envio", { caso: "ec-corp-andina", confirmado: true })).error).toContain("armar el paquete")
  })
})
