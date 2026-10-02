import type http from "node:http"
import { crearAlmacen } from "./agent/sesiones"
import { leerConfig } from "./config"
import { crearAdaptador } from "./llm"
import { crearManejador, type Manejador } from "./server"

/**
 * Función de Vercel: atiende /api/*. El front se sirve como estático (ver scripts/build-vercel.ts).
 * La instancia se reutiliza entre peticiones mientras siga viva, así que el agente se arma una sola vez.
 */
let manejador: Manejador | undefined

export default async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    if (!manejador) {
      const config = leerConfig()
      manejador = crearManejador(crearAdaptador(config), config, crearAlmacen())
    }
  } catch (e) {
    // Configuración incompleta (p. ej. falta ANTHROPIC_API_KEY en el panel de Vercel): se explica en vez de tumbar la función.
    const motivo = e instanceof Error ? e.message : String(e)
    console.error("[vercel]", motivo)
    res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify({ error: `configuración incompleta: ${motivo}` }))
    return
  }
  await manejador(req, res)
}
