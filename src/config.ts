import { z } from "zod"
import reglas from "./knowledge/reglas.json"

const esquemaEntorno = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LLM_PROVIDER: z.enum(["anthropic"]).default("anthropic"),
  LLM_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_MAX_TOKENS_RESPUESTA: z.coerce.number().int().positive().default(4_096),
  MAX_ITERACIONES: z.coerce.number().int().positive().default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().positive().default(300_000),
  MAX_TOKENS_GLOBAL: z.coerce.number().int().positive().default(5_000_000),
  ACCESS_KEY: z.string().optional(),
  FECHA_EJECUCION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato YYYY-MM-DD").optional(),
})

export type Config = z.infer<typeof esquemaEntorno>

export function leerConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  // Una variable vacía (p. ej. "FECHA_EJECUCION=" copiada de .env.example) cuenta como no definida.
  const definidas = Object.fromEntries(Object.entries(entorno).filter(([, v]) => v !== undefined && v.trim() !== ""))
  const r = esquemaEntorno.safeParse(definidas)
  if (!r.success) throw new Error(`Variables de entorno inválidas: ${z.prettifyError(r.error)}`)
  return r.data
}

/** Fecha de ejecución (YYYY-MM-DD) en la zona del negocio. FECHA_EJECUCION la fija para pruebas. */
export function fechaEjecucion(entorno: NodeJS.ProcessEnv = process.env): string {
  const fija = entorno.FECHA_EJECUCION
  if (fija && /^\d{4}-\d{2}-\d{2}$/.test(fija)) return fija
  return new Intl.DateTimeFormat("en-CA", { timeZone: reglas.zona_horaria }).format(new Date())
}
