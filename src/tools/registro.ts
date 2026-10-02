import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Ctx } from "./lib/contrato"
import { existeCaso } from "./lib/fixtures"
import { rutas } from "./lib/rutas"
import * as proveedor from "./proveedor"

/** Herramienta con los tipos de argumentos borrados. zod valida en tiempo de ejecución antes de llamar a execute. */
interface HerramientaGenerica {
  description: string
  args: z.ZodRawShape
  execute: (args: never, ctx: Ctx) => Promise<string>
}

export interface DefinicionHerramienta {
  nombre: string
  descripcion: string
  /** JSON Schema de los argumentos, generado desde zod. */
  parametros: Record<string, unknown>
}

export interface ResultadoEjecucion {
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
  /** String JSON tal como lo devolvió la herramienta. */
  resultado: string
}

function esHerramienta(v: unknown): v is HerramientaGenerica {
  return typeof v === "object" && v !== null && "description" in v && "args" in v && "execute" in v
}

/** Cada export de un archivo de herramientas se registra como `<archivo>_<export>` (PRD §6.2). */
function registrarModulo(archivo: string, modulo: Record<string, unknown>): Map<string, HerramientaGenerica> {
  const mapa = new Map<string, HerramientaGenerica>()
  for (const [exportado, valor] of Object.entries(modulo)) {
    if (esHerramienta(valor)) mapa.set(`${archivo}_${exportado}`, valor)
  }
  return mapa
}

const HERRAMIENTAS = registrarModulo("proveedor", proveedor)

export function definiciones(): DefinicionHerramienta[] {
  return [...HERRAMIENTAS].map(([nombre, h]) => ({
    nombre,
    descripcion: h.description,
    parametros: z.toJSONSchema(z.object(h.args)) as Record<string, unknown>,
  }))
}

const esquemaRespuesta = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

function resumir(salida: string): { ok: boolean; resumen: string } {
  try {
    const r = esquemaRespuesta.parse(JSON.parse(salida))
    if (!r.ok) return { ok: false, resumen: r.error }
    const resumen = typeof r.data === "object" && r.data !== null && "resumen" in r.data ? String(r.data.resumen) : "ok"
    return { ok: true, resumen }
  } catch {
    return { ok: false, resumen: "la herramienta devolvió una respuesta inválida" }
  }
}

export function registrarLog(ctx: Ctx, nombre: string, args: unknown, ok: boolean, resumen: string) {
  const ts = new Date().toISOString()
  const { out, logGlobal } = rutas(ctx)
  fs.mkdirSync(out, { recursive: true })
  fs.appendFileSync(logGlobal, JSON.stringify({ ts, sessionId: ctx.sessionId, herramienta: nombre, args, ok, resumen }) + "\n")
  const caso = typeof args === "object" && args !== null && "caso" in args ? String(args.caso) : null
  if (caso && /^[a-z0-9][a-z0-9-]{0,80}$/.test(caso) && existeCaso(ctx, caso)) {
    const dir = path.join(out, caso)
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, "log.jsonl"), JSON.stringify({ ts, herramienta: nombre, ok, resumen }) + "\n")
  }
}

/** Valida argumentos con zod, ejecuta y registra en log. Nunca lanza. */
export async function ejecutar(nombre: string, args: unknown, ctx: Ctx): Promise<ResultadoEjecucion> {
  const h = HERRAMIENTAS.get(nombre)
  let salida: string
  if (!h) {
    salida = JSON.stringify({ ok: false, error: `herramienta desconocida: ${nombre}` })
  } else {
    const validado = z.object(h.args).safeParse(args)
    if (!validado.success) {
      salida = JSON.stringify({ ok: false, error: `argumentos inválidos: ${z.prettifyError(validado.error)}` })
    } else {
      try {
        salida = await h.execute(validado.data as never, ctx)
      } catch (e) {
        salida = JSON.stringify({ ok: false, error: `error inesperado: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
  }
  const { ok, resumen } = resumir(salida)
  try {
    registrarLog(ctx, nombre, args, ok, resumen)
  } catch {
    /* un fallo de log no debe tumbar la herramienta */
  }
  return { nombre, args, ok, resumen, resultado: salida }
}
