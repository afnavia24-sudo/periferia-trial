/**
 * Interfaz propia del proveedor de lenguaje (PRD §6.1). El ciclo del agente solo conoce estos tipos:
 * cambiar de proveedor = escribir otra implementación de AdaptadorLLM, sin tocar el ciclo.
 */
export type Bloque =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; id: string; nombre: string; args: Record<string, unknown> }
  | { tipo: "resultado"; idLlamada: string; contenido: string; esError: boolean }

export interface Mensaje {
  rol: "usuario" | "asistente"
  bloques: Bloque[]
}

export interface HerramientaLLM {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
}

export interface RespuestaLLM {
  bloques: Bloque[]
  /** "herramientas": el modelo pidió ejecutar herramientas; "final": respondió al usuario. */
  fin: "herramientas" | "final" | "limite_tokens"
  uso: { entrada: number; salida: number }
}

export interface OpcionesEnvio {
  sistema: string
}

export interface AdaptadorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: HerramientaLLM[], opciones: OpcionesEnvio): Promise<RespuestaLLM>
}

/** Error del proveedor con mensaje apto para el usuario (sin trazas ni claves). */
export class ErrorLLM extends Error {}
