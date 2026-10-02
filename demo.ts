/**
 * Verificación sin modelo (PRD §6.6): ejecuta todos los casos llamando directamente a las herramientas.
 *   npm run demo        (o: bun run demo.ts)
 * No necesita clave de ningún proveedor. Limpia out/ al inicio.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { ejecutar } from "./src/tools/registro"

export interface ResumenCaso {
  caso: string
  formato: string
  llenos: number
  faltantes: string[]
  por_confirmar: string[]
  formulario: string | null
  listo_para_firma: boolean | null
  motivos: string[]
  envio_sin_confirmacion: string
  errores: string[]
}

const respuesta = z.object({ ok: z.boolean(), data: z.record(z.string(), z.unknown()).optional(), error: z.string().optional() })
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null && "etiqueta" in x ? String(x.etiqueta) : String(x))) : [])

export async function ejecutarDemo(directory: string): Promise<ResumenCaso[]> {
  fs.rmSync(path.join(directory, "out"), { recursive: true, force: true })
  const ctx = { directory, sessionId: "demo" }
  const casos = fs.readdirSync(path.join(directory, "fixtures", "reto-01", "casos")).filter((c) => !c.startsWith(".")).sort()
  const resumenes: ResumenCaso[] = []
  for (const caso of casos) {
    const llamar = async (h: string, args: Record<string, unknown>) => respuesta.parse(JSON.parse((await ejecutar(`proveedor_${h}`, { caso, ...args }, ctx)).resultado))
    const r: ResumenCaso = { caso, formato: "?", llenos: 0, faltantes: [], por_confirmar: [], formulario: null, listo_para_firma: null, motivos: [], envio_sin_confirmacion: "", errores: [] }
    const leer = await llamar("leer_solicitud", {})
    if (!leer.ok || !leer.data) { r.errores.push(leer.error ?? "sin datos"); resumenes.push(r); continue }
    r.formato = String(leer.data.formato)
    const mapeo = await llamar("mapear_campos", { campos: lista(leer.data.campos) })
    if (mapeo.ok && mapeo.data) {
      r.llenos = lista(mapeo.data.llenos).length
      r.faltantes = lista(mapeo.data.faltantes)
      r.por_confirmar = lista(mapeo.data.requiere_confirmacion)
    } else r.errores.push(mapeo.error ?? "")
    const gen = await llamar("generar_formulario", {})
    if (gen.ok && gen.data) r.formulario = String(gen.data.ruta)
    else r.errores.push(gen.error ?? "")
    const paq = await llamar("armar_paquete", {})
    if (paq.ok && paq.data) {
      r.listo_para_firma = paq.data.listo_para_firma === true
      const checklist = z.object({ motivos_bloqueo: z.array(z.string()) }).safeParse(paq.data.checklist)
      r.motivos = checklist.success ? checklist.data.motivos_bloqueo : []
    } else r.errores.push(paq.error ?? "")
    const envio = await llamar("simular_envio", { confirmado: false })
    r.envio_sin_confirmacion = envio.ok ? "⚠️ se envió sin confirmación" : `bloqueado: ${envio.error}`
    resumenes.push(r)
  }
  return resumenes
}

function imprimir(resumenes: ResumenCaso[]) {
  for (const r of resumenes) {
    console.log(`\n■ ${r.caso}  [${r.formato}]`)
    console.log(`  campos llenos:      ${r.llenos}`)
    console.log(`  faltantes:          ${r.faltantes.join(", ") || "ninguno"}`)
    console.log(`  por confirmar:      ${r.por_confirmar.join(", ") || "ninguno"}`)
    console.log(`  formulario:         ${r.formulario ?? "—"}`)
    console.log(`  listo para firma:   ${r.listo_para_firma === null ? "—" : r.listo_para_firma ? "SÍ" : `NO (${r.motivos.join("; ")})`}`)
    console.log(`  envío sin confirmar: ${r.envio_sin_confirmacion}`)
    if (r.errores.length) console.log(`  errores:            ${r.errores.join(" | ")}`)
  }
  console.log(`\nSalida en out/. Fecha de ejecución: ${process.env.FECHA_EJECUCION ?? "hoy (America/Bogota)"}.`)
}

const esPrincipal = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) imprimir(await ejecutarDemo(path.dirname(fileURLToPath(import.meta.url))))
