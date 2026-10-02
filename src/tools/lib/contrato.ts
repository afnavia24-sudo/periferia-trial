import type { z } from "zod"

/** Contexto que el backend pasa a cada herramienta (PRD §6.2). */
export interface Ctx {
  /** Raíz del proyecto. Todas las rutas se resuelven desde aquí. */
  directory: string
  sessionId: string
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

/** Forma de una herramienta: exactamente description, args y execute. */
export interface Herramienta<A> {
  description: string
  args: z.ZodRawShape
  execute(args: A, ctx: Ctx): Promise<string>
}

/** Error de negocio: su mensaje es apto para mostrarse al usuario. */
export class ErrorNegocio extends Error {}

/** Ejecuta la lógica y serializa `{ ok, data }` o `{ ok: false, error }`. Nunca lanza. */
export async function responder<T>(logica: () => Promise<T> | T): Promise<string> {
  try {
    const data = await logica()
    return JSON.stringify({ ok: true, data } satisfies Resultado<T>)
  } catch (e) {
    const error = e instanceof ErrorNegocio ? e.message : `error inesperado: ${e instanceof Error ? e.message : String(e)}`
    return JSON.stringify({ ok: false, error } satisfies Resultado<T>)
  }
}
