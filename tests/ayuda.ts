import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AdaptadorLLM, Bloque, HerramientaLLM, Mensaje, RespuestaLLM } from "../src/llm/adapter"
import { ejecutar } from "../src/tools/registro"

export const RAIZ = path.resolve(import.meta.dirname, "..")

/** Copia fixtures, prompt y conocimiento a un directorio temporal: los tests nunca escriben en el repo. */
export function proyectoTemporal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reto01-"))
  for (const p of ["fixtures", "agent", "src/knowledge"]) fs.cpSync(path.join(RAIZ, p), path.join(dir, p), { recursive: true })
  return dir
}

export interface Respuesta { ok: boolean; data?: Record<string, unknown>; error?: string }

export async function herramienta(dir: string, nombre: string, args: Record<string, unknown>): Promise<Respuesta> {
  const r = await ejecutar(`proveedor_${nombre}`, args, { directory: dir, sessionId: "test" })
  return JSON.parse(r.resultado) as Respuesta
}

/** Adaptador guionado: devuelve respuestas predefinidas y registra lo que recibe. */
export class AdaptadorFalso implements AdaptadorLLM {
  readonly proveedor = "falso"
  readonly modelo = "guion"
  llamadas: { mensajes: Mensaje[]; herramientas: HerramientaLLM[] }[] = []
  constructor(private guion: (RespuestaLLM | Error)[] = []) {}
  agregar(...r: (RespuestaLLM | Error)[]) { this.guion.push(...r) }
  async enviar(mensajes: Mensaje[], herramientas: HerramientaLLM[]): Promise<RespuestaLLM> {
    this.llamadas.push({ mensajes: structuredClone(mensajes), herramientas })
    const r = this.guion.shift()
    if (!r) throw new Error("guion agotado")
    if (r instanceof Error) throw r
    return r
  }
}

let n = 0
export const usarHerramienta = (nombre: string, args: Record<string, unknown>): RespuestaLLM => ({
  bloques: [{ tipo: "llamada", id: `t${n++}`, nombre, args }], fin: "herramientas", uso: { entrada: 100, salida: 10 },
})
export const responderTexto = (texto: string): RespuestaLLM => ({ bloques: [{ tipo: "texto", texto } as Bloque], fin: "final", uso: { entrada: 100, salida: 10 } })
