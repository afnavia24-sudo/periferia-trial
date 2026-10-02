import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { Agente, cargarSistema } from "./agent/ciclo"
import { AlmacenMemoria, crearAlmacen, type AlmacenSesiones } from "./agent/sesiones"
import { leerConfig } from "./config"
import type { AdaptadorLLM } from "./llm/adapter"
import { crearAdaptador } from "./llm"

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ESTATICOS: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/styles.css": "styles.css" }
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }
const MAX_CUERPO = 64 * 1024

function listarCasos(): string[] {
  const dir = path.join(RAIZ, "fixtures", "reto-01", "casos")
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((c) => !c.startsWith(".")).sort() : []
}

const cuerpoChat = z.object({ sessionId: z.string().max(64).optional(), message: z.string().trim().min(1).max(4000) })

function json(res: http.ServerResponse, estado: number, datos: unknown) {
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(datos))
}

function leerCuerpo(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0
    const partes: Buffer[] = []
    req.on("data", (c: Buffer) => {
      total += c.length
      if (total > MAX_CUERPO) reject(new Error("cuerpo demasiado grande"))
      else partes.push(c)
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"))
      } catch {
        reject(new Error("JSON inválido"))
      }
    })
    req.on("error", reject)
  })
}

export type Manejador = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>

/** Atiende una petición. Lo usan el servidor HTTP local y la función de Vercel (src/vercel.ts). */
export function crearManejador(adaptador: AdaptadorLLM, opciones = leerConfig(), sesiones: AlmacenSesiones = new AlmacenMemoria()): Manejador {
  const agente = new Agente({
    adaptador,
    sistema: cargarSistema(RAIZ),
    directory: RAIZ,
    maxIteraciones: opciones.MAX_ITERACIONES,
    maxTokensSesion: opciones.MAX_TOKENS_SESION,
    presupuestoGlobal: { usados: 0, maximo: opciones.MAX_TOKENS_GLOBAL },
  })
  const autorizado = (req: http.IncomingMessage) => !opciones.ACCESS_KEY || req.headers["x-access-key"] === opciones.ACCESS_KEY

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    try {
      if (req.method === "GET" && ESTATICOS[url.pathname]) {
        const archivo = path.join(RAIZ, "web", ESTATICOS[url.pathname] ?? "index.html")
        res.writeHead(200, { "content-type": TIPOS[path.extname(archivo)] ?? "text/plain" })
        res.end(fs.readFileSync(archivo))
        return
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        return json(res, 200, { ok: true, provider: adaptador.proveedor, model: adaptador.modelo, requiresAccessKey: Boolean(opciones.ACCESS_KEY), sessionStore: sesiones.tipo, casos: listarCasos() })
      }
      if (url.pathname.startsWith("/api/") && !autorizado(req)) return json(res, 401, { error: "clave de acceso inválida" })

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const cuerpo = cuerpoChat.safeParse(await leerCuerpo(req))
        if (!cuerpo.success) return json(res, 400, { error: "se espera { sessionId?, message } con un mensaje de 1 a 4000 caracteres" })
        const sesion = await sesiones.obtenerOCrear(cuerpo.data.sessionId)
        if (!(await sesiones.tomar(sesion.id))) return json(res, 409, { error: "la sesión está procesando otro mensaje" })
        try {
          const respuesta = await agente.turno(sesion, cuerpo.data.message)
          await sesiones.guardar(sesion)
          return json(res, 200, respuesta)
        } finally {
          await sesiones.soltar(sesion.id)
        }
      }

      const m = url.pathname.match(/^\/api\/sessions\/([\w-]{8,64})$/)
      if (req.method === "GET" && m?.[1]) {
        const s = await sesiones.obtener(m[1])
        if (!s) return json(res, 404, { error: "sesión no encontrada" })
        return json(res, 200, { id: s.id, creada: s.creada, tokensUsados: s.tokensUsados, needsConfirmation: s.confirmacionPendiente !== null, historial: s.historial })
      }
      return json(res, 404, { error: "no encontrado" })
    } catch (e) {
      // CA5: nunca se expone una traza al cliente
      console.error("[server]", e instanceof Error ? e.message : e)
      if (!res.headersSent) json(res, 500, { error: "error interno del servidor" })
    }
  }
}

export function crearServidor(adaptador: AdaptadorLLM, opciones = leerConfig(), sesiones?: AlmacenSesiones) {
  return http.createServer(crearManejador(adaptador, opciones, sesiones))
}

const esPrincipal = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  const config = leerConfig()
  const adaptador = crearAdaptador(config)
  crearServidor(adaptador, config, crearAlmacen()).listen(config.PORT, () => {
    console.log(`Agente listo en http://localhost:${config.PORT} · ${adaptador.proveedor}/${adaptador.modelo}`)
  })
}
