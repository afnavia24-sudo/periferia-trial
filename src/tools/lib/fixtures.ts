import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ErrorNegocio, type Ctx } from "./contrato"
import { dirCaso, rutas } from "./rutas"

export const esquemaSolicitud = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string().length(2),
  cliente: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
})
export type Solicitud = z.infer<typeof esquemaSolicitud>

const esquemaCelda = z.object({
  hoja: z.string().min(1),
  celda_etiqueta: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/),
  etiqueta: z.string().min(1),
  celda_valor: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/),
})
const esquemaCampo = z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() })

export type Celda = z.infer<typeof esquemaCelda>
export type CampoPlantilla = z.infer<typeof esquemaCampo>
export type Plantilla =
  | { tipo: "celdas"; archivo: string; items: Celda[] }
  | { tipo: "campos"; archivo: string; items: CampoPlantilla[] }

const esquemaSoporte = z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  pais_emisor: z.string(),
  descripcion: z.string().optional(),
})
export type SoporteRepositorio = z.infer<typeof esquemaSoporte>

export type Maestro = Record<string, unknown>

function leerJson<T>(ruta: string, esquema: z.ZodType<T>, nombre: string): T {
  if (!fs.existsSync(ruta)) throw new ErrorNegocio(`no existe ${nombre}`)
  let crudo: unknown
  try {
    crudo = JSON.parse(fs.readFileSync(ruta, "utf8"))
  } catch {
    throw new ErrorNegocio(`${nombre} está corrupto (no es JSON válido)`)
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) throw new ErrorNegocio(`${nombre} no tiene la estructura esperada: ${r.error.issues[0]?.message ?? "inválido"}`)
  return r.data
}

export function existeCaso(ctx: Ctx, caso: string): boolean {
  return fs.existsSync(path.join(dirCaso(ctx, caso), "solicitud.json"))
}

export function cargarSolicitud(ctx: Ctx, caso: string): Solicitud {
  if (!existeCaso(ctx, caso)) throw new ErrorNegocio(`el caso "${caso}" no existe en fixtures/reto-01/casos/`)
  return leerJson(path.join(dirCaso(ctx, caso), "solicitud.json"), esquemaSolicitud, `solicitud.json de ${caso}`)
}

/** Carga la plantilla del caso. Para portal se usa plantilla-campos.json si existe. */
export function cargarPlantilla(ctx: Ctx, caso: string, formato: Solicitud["formato"]): Plantilla {
  const dir = dirCaso(ctx, caso)
  const celdas = path.join(dir, "plantilla-celdas.json")
  const campos = path.join(dir, "plantilla-campos.json")
  if (formato === "xlsx" || (formato === "portal" && fs.existsSync(celdas) && !fs.existsSync(campos))) {
    return { tipo: "celdas", archivo: "plantilla-celdas.json", items: leerJson(celdas, z.array(esquemaCelda).min(1), "plantilla-celdas.json") }
  }
  return { tipo: "campos", archivo: "plantilla-campos.json", items: leerJson(campos, z.array(esquemaCampo).min(1), "plantilla-campos.json") }
}

export function etiquetasDe(plantilla: Plantilla): string[] {
  return plantilla.items.map((i) => i.etiqueta)
}

export function cargarSoportesExigidos(ctx: Ctx, caso: string): string[] {
  return leerJson(path.join(dirCaso(ctx, caso), "soportes-exigidos.json"), z.array(z.string()), "soportes-exigidos.json")
}

export function cargarMaestro(ctx: Ctx): Maestro {
  return leerJson(rutas(ctx).maestro, z.record(z.string(), z.unknown()), "repositorio/maestro.json")
}

export function cargarGlosario(ctx: Ctx): Record<string, string> {
  return leerJson(rutas(ctx).glosario, z.record(z.string(), z.string()), "glosario-campos.json")
}

export function cargarIndiceSoportes(ctx: Ctx): SoporteRepositorio[] {
  return leerJson(path.join(rutas(ctx).soportes, "index.json"), z.array(esquemaSoporte), "repositorio/soportes/index.json")
}
