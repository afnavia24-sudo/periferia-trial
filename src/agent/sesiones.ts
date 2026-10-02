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

function nuevaSesion(id?: string): Sesion {
  return { id: id && /^[\w-]{8,64}$/.test(id) ? id : randomUUID(), creada: new Date().toISOString(), mensajes: [], historial: [], tokensUsados: 0, confirmacionPendiente: null, ocupada: false }
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
    const s = nuevaSesion(id)
    this.mapa.set(s.id, s)
    return s
  }
}

/**
 * Dónde viven las sesiones entre mensajes. En un servidor basta la memoria; en Vercel cada
 * petición puede llegar a otra instancia, así que la confirmación de envío (CA3) se perdería.
 */
export interface AlmacenSesiones {
  readonly tipo: "memoria" | "redis"
  obtener(id: string): Promise<Sesion | undefined>
  obtenerOCrear(id?: string): Promise<Sesion>
  guardar(s: Sesion): Promise<void>
  /** Marca la sesión como ocupada. Devuelve false si otro mensaje (de cualquier instancia) la está procesando. */
  tomar(id: string): Promise<boolean>
  soltar(id: string): Promise<void>
}

export class AlmacenMemoria implements AlmacenSesiones {
  readonly tipo = "memoria"
  private sesiones: Sesiones

  constructor(maxSesiones?: number) {
    this.sesiones = new Sesiones(maxSesiones)
  }

  async obtener(id: string) {
    return this.sesiones.obtener(id)
  }
  async obtenerOCrear(id?: string) {
    return this.sesiones.obtenerOCrear(id)
  }
  async guardar() {
    /* el objeto en memoria ya es la sesión */
  }
  async tomar(id: string) {
    const s = this.sesiones.obtener(id)
    if (!s || s.ocupada) return false
    s.ocupada = true
    return true
  }
  async soltar(id: string) {
    const s = this.sesiones.obtener(id)
    if (s) s.ocupada = false
  }
}

type Fetch = typeof fetch

/** Sesiones en Upstash Redis por su API REST (sin dependencias). Expiran tras `ttlSegundos` sin uso. */
export class AlmacenRedis implements AlmacenSesiones {
  readonly tipo = "redis"

  constructor(
    private url: string,
    private token: string,
    private opciones: { ttlSegundos?: number; ttlBloqueoSegundos?: number; fetch?: Fetch } = {},
  ) {}

  private async comando(...args: string[]): Promise<unknown> {
    const r = await (this.opciones.fetch ?? fetch)(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    })
    const cuerpo = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string }
    if (!r.ok || cuerpo.error) throw new Error(`Redis respondió ${r.status}: ${cuerpo.error ?? "sin detalle"}`)
    return cuerpo.result
  }

  async obtener(id: string) {
    const crudo = await this.comando("GET", `sesion:${id}`)
    return typeof crudo === "string" ? { ...(JSON.parse(crudo) as Sesion), ocupada: false } : undefined
  }
  async obtenerOCrear(id?: string) {
    return (id ? await this.obtener(id) : undefined) ?? nuevaSesion(id)
  }
  async guardar(s: Sesion) {
    const { ocupada: _, ...persistible } = s
    await this.comando("SET", `sesion:${s.id}`, JSON.stringify(persistible), "EX", String(this.opciones.ttlSegundos ?? 86_400))
  }
  async tomar(id: string) {
    // Expira solo por si una instancia muere a mitad de turno; debe superar la duración máxima de la función.
    return (await this.comando("SET", `sesion:${id}:ocupada`, "1", "NX", "EX", String(this.opciones.ttlBloqueoSegundos ?? 330))) === "OK"
  }
  async soltar(id: string) {
    await this.comando("DEL", `sesion:${id}:ocupada`)
  }
}

/** Redis si están las variables de Upstash (las que crea la integración de Vercel o las propias), si no memoria. */
export function crearAlmacen(entorno: NodeJS.ProcessEnv = process.env): AlmacenSesiones {
  const url = entorno.KV_REST_API_URL || entorno.UPSTASH_REDIS_REST_URL
  const token = entorno.KV_REST_API_TOKEN || entorno.UPSTASH_REDIS_REST_TOKEN
  return url && token ? new AlmacenRedis(url, token) : new AlmacenMemoria()
}
