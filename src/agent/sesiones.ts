import { randomUUID } from "node:crypto"
import type { Mensaje } from "../llm/adapter"

export interface LlamadaVisible {
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
  bloqueada: boolean
}

export interface EventoVisible {
  ts: string
  rol: "usuario" | "agente" | "sistema"
  texto: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
}

export interface Sesion {
  id: string
  creada: string
  mensajes: Mensaje[]
  historial: EventoVisible[]
  tokensUsados: number
  /** Caso cuyo envío espera confirmación en el próximo mensaje del usuario (CA3). */
  confirmacionPendiente: string | null
  ocupada: boolean
}

/** Sesiones en memoria (PRD: sin base de datos). */
export class Sesiones {
  private mapa = new Map<string, Sesion>()

  constructor(private maxSesiones = 500) {}

  obtener(id: string): Sesion | undefined {
    return this.mapa.get(id)
  }

  obtenerOCrear(id?: string): Sesion {
    const existente = id ? this.mapa.get(id) : undefined
    if (existente) return existente
    if (this.mapa.size >= this.maxSesiones) {
      const masAntigua = this.mapa.keys().next().value
      if (masAntigua) this.mapa.delete(masAntigua)
    }
    const s: Sesion = { id: id && /^[\w-]{8,64}$/.test(id) ? id : randomUUID(), creada: new Date().toISOString(), mensajes: [], historial: [], tokensUsados: 0, confirmacionPendiente: null, ocupada: false }
    this.mapa.set(s.id, s)
    return s
  }
}
