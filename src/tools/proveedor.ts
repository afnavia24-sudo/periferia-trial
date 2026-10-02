/**
 * Herramientas del agente. Cada export es una herramienta; el modelo la ve como `proveedor_<export>`.
 * Contrato (PRD §6.2): { description, args (zod), execute(args, ctx) } → string JSON { ok, data } | { ok: false, error }.
 * Son la ÚNICA fuente de valores que el agente puede afirmar.
 */
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import reglas from "../knowledge/reglas.json"
import { fechaEjecucion } from "../config"
import { ErrorNegocio, responder, type Ctx } from "./lib/contrato"
import {
  cargarGlosario, cargarIndiceSoportes, cargarMaestro, cargarPlantilla, cargarSolicitud, cargarSoportesExigidos,
  etiquetasDe, type Plantilla, type Solicitud,
} from "./lib/fixtures"
import { escribirPdf, escribirValoresPortal, escribirXlsx } from "./lib/formularios"
import { mapearEtiquetas, mapeoParaChat, valorEnMaestro, type Mapeo } from "./lib/mapeo"
import { contieneDatosBancarios, evaluarSoporte, renderBorrador, renderChecklist } from "./lib/paquete"
import { dirSalida, relativa, rutas } from "./lib/rutas"

const caso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, p. ej. 'ec-corp-andina'")

const ARCHIVO_FORMULARIO: Record<Solicitud["formato"], string> = { xlsx: "formulario.xlsx", pdf: "formulario.pdf", portal: "valores-portal.md" }

function identificadorDelPais(pais: string): string {
  const mapa: Record<string, string> = reglas.identificador_por_pais
  return mapa[pais] ?? "desconocido"
}

function intentarPlantilla(ctx: Ctx, c: string, s: Solicitud): { plantilla: Plantilla | null; error: string | null } {
  try {
    return { plantilla: cargarPlantilla(ctx, c, s.formato), error: null }
  } catch (e) {
    return { plantilla: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function proveedorDelMaestro(ctx: Ctx): string {
  const r = valorEnMaestro(cargarMaestro(ctx), "razon_social")
  if (r === undefined) throw new ErrorNegocio("el maestro no tiene razon_social")
  return String(r)
}

// ───────────────────────────────────────────── HU-1
const argsLeer = { caso }
export const leer_solicitud = {
  description: "Lee la solicitud del cliente y su plantilla: devuelve país, cliente, formato, campos pedidos y soportes exigidos.",
  args: argsLeer,
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return responder(() => {
      const s = cargarSolicitud(ctx, args.caso)
      const advertencias: string[] = []
      const { plantilla, error } = intentarPlantilla(ctx, args.caso, s)
      if (error) advertencias.push(`${error}; se continúa sin campos`)
      let soportes: string[] = []
      try {
        soportes = cargarSoportesExigidos(ctx, args.caso)
      } catch (e) {
        advertencias.push(`${e instanceof Error ? e.message : String(e)}; se continúa sin soportes exigidos`)
      }
      const campos = plantilla ? etiquetasDe(plantilla) : []
      const porPais = campos.length
        ? mapearEtiquetas(campos, cargarMaestro(ctx), cargarGlosario(ctx), s.pais).requiere_confirmacion
            .filter((c) => c.ruta === reglas.ruta_identificador_tributario)
            .map((c) => ({ etiqueta: c.etiqueta, motivo: c.motivo, propuesta: identificadorDelPais(s.pais) }))
        : []
      return {
        caso: args.caso, cliente: s.cliente, pais: s.pais, identificador_del_pais: identificadorDelPais(s.pais),
        formato: s.formato, de: s.de, asunto: s.asunto, fecha: s.fecha, adjuntos: s.adjuntos, cuerpo: s.cuerpo,
        plantilla: plantilla?.archivo ?? null, campos, soportes, requiere_confirmacion: porPais, advertencias,
        resumen: `${s.cliente} (${s.pais}), ${s.formato}, ${campos.length} campos, ${soportes.length} soportes${advertencias.length ? ", con advertencias" : ""}`,
      }
    })
  },
}

// ───────────────────────────────────────────── HU-2
const argsMapear = {
  caso,
  campos: z.array(z.string()).describe("Etiquetas devueltas por proveedor_leer_solicitud. Vacío = todas las de la plantilla."),
}
export const mapear_campos = {
  description: "Cruza cada campo pedido con el repositorio maestro y el glosario: lleno (con ruta), faltante o requiere_confirmacion.",
  args: argsMapear,
  async execute(args: { caso: string; campos: string[] }, ctx: Ctx): Promise<string> {
    return responder(() => {
      const s = cargarSolicitud(ctx, args.caso)
      const { plantilla, error } = intentarPlantilla(ctx, args.caso, s)
      const deLaPlantilla = plantilla ? etiquetasDe(plantilla) : []
      const campos = args.campos.length ? args.campos : deLaPlantilla
      if (!campos.length) throw new ErrorNegocio(`no hay campos para mapear${error ? ` (${error})` : ""}`)
      const advertencias = plantilla ? campos.filter((c) => !deLaPlantilla.includes(c)).map((c) => `"${c}" no está en la plantilla del cliente`) : []
      const mapeo = mapeoParaChat(mapearEtiquetas(campos, cargarMaestro(ctx), cargarGlosario(ctx), s.pais))
      fs.writeFileSync(path.join(dirSalida(ctx, args.caso), "mapeo.json"), JSON.stringify(mapeo, null, 2))
      return {
        caso: args.caso, pais: s.pais, total: campos.length, ...mapeo, advertencias,
        nota: "Los valores sensibles se muestran enmascarados; el formulario usa los del maestro.",
        resumen: `${mapeo.llenos.length} llenos, ${mapeo.faltantes.length} faltantes, ${mapeo.requiere_confirmacion.length} por confirmar`,
      }
    })
  },
}

// ───────────────────────────────────────────── HU-3
const referencia = z.object({ etiqueta: z.string() })
const argsGenerar = {
  caso,
  mapeo: z
    .object({ llenos: z.array(referencia).default([]), faltantes: z.array(referencia).default([]), requiere_confirmacion: z.array(referencia).default([]) })
    .optional()
    .describe("Resultado de proveedor_mapear_campos. Los valores se toman siempre del maestro; el mapeo solo se usa para verificar."),
}
type ArgsGenerar = { caso: string; mapeo?: { llenos: { etiqueta: string }[]; faltantes: { etiqueta: string }[]; requiere_confirmacion: { etiqueta: string }[] } }

function discrepancias(recibido: ArgsGenerar["mapeo"], real: Mapeo): string[] {
  if (!recibido) return []
  const estados: [keyof Mapeo, { etiqueta: string }[]][] = [["llenos", recibido.llenos], ["faltantes", recibido.faltantes], ["requiere_confirmacion", recibido.requiere_confirmacion]]
  const out: string[] = []
  for (const [estado, lista] of estados) {
    for (const { etiqueta } of lista) {
      if (!real[estado].some((c) => c.etiqueta === etiqueta)) out.push(`"${etiqueta}" llegó como ${estado}, pero el mapeo del maestro dice otra cosa; se usó el del maestro`)
    }
  }
  return out
}

export const generar_formulario = {
  description: "Genera el formulario lleno en el formato del cliente (xlsx o pdf); para portal genera los valores en Markdown.",
  args: argsGenerar,
  async execute(args: ArgsGenerar, ctx: Ctx): Promise<string> {
    return responder(async () => {
      const s = cargarSolicitud(ctx, args.caso)
      const { plantilla, error } = intentarPlantilla(ctx, args.caso, s)
      if (!plantilla) throw new ErrorNegocio(`no se puede generar el formulario: ${error}`)
      const mapeo = mapearEtiquetas(etiquetasDe(plantilla), cargarMaestro(ctx), cargarGlosario(ctx), s.pais)
      const destino = path.join(dirSalida(ctx, args.caso), ARCHIVO_FORMULARIO[s.formato])
      let escritura
      if (s.formato === "xlsx" && plantilla.tipo === "celdas") escritura = await escribirXlsx(plantilla.items, mapeo, destino)
      else if (s.formato === "pdf" && plantilla.tipo === "campos") escritura = await escribirPdf(plantilla.items, mapeo, s, proveedorDelMaestro(ctx), destino)
      else if (s.formato === "portal") escritura = escribirValoresPortal(plantilla, mapeo, s, destino)
      else throw new ErrorNegocio(`la plantilla ${plantilla.archivo} no corresponde al formato ${s.formato}`)
      const aviso = s.formato === "portal" ? "formato no soportado: portal web. Se generaron los valores para copiar manualmente." : null
      return {
        ruta: relativa(ctx, destino), formato: s.formato, escritos: escritura.escritos, vacios: escritura.vacios,
        discrepancias: discrepancias(args.mapeo, mapeo), aviso,
        resumen: `${relativa(ctx, destino)}: ${escritura.escritos} campos escritos, ${escritura.vacios.length} vacíos${aviso ? " (portal: no soportado)" : ""}`,
      }
    })
  },
}

// ───────────────────────────────────────────── HU-4
export const armar_paquete = {
  description: "Arma out/<caso>/paquete/ con formulario, soportes, checklist.md y borrador-correo.md, y evalúa si está listo para firma.",
  args: { caso },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return responder(() => {
      const s = cargarSolicitud(ctx, args.caso)
      const fecha = fechaEjecucion()
      const salida = dirSalida(ctx, args.caso)
      const paquete = path.join(salida, "paquete")
      fs.rmSync(paquete, { recursive: true, force: true })
      fs.rmSync(path.join(salida, "ENVIO-SIMULADO.md"), { force: true })
      fs.mkdirSync(paquete, { recursive: true })

      const advertencias: string[] = []
      let exigidos: string[] = []
      try {
        exigidos = cargarSoportesExigidos(ctx, args.caso)
      } catch (e) {
        advertencias.push(e instanceof Error ? e.message : String(e))
      }
      const dirSoportes = rutas(ctx).soportes
      const soportes = exigidos.map((t) => evaluarSoporte(t, cargarIndiceSoportes(ctx), (a) => fs.existsSync(path.join(dirSoportes, a)), fecha, s.pais))
      for (const sp of soportes) if (sp.archivo) fs.copyFileSync(path.join(dirSoportes, sp.archivo), path.join(paquete, sp.archivo))

      const origenFormulario = path.join(salida, ARCHIVO_FORMULARIO[s.formato])
      const formulario = fs.existsSync(origenFormulario) ? ARCHIVO_FORMULARIO[s.formato] : null
      if (formulario) fs.copyFileSync(origenFormulario, path.join(paquete, formulario))

      const { plantilla } = intentarPlantilla(ctx, args.caso, s)
      const mapeo = plantilla ? mapearEtiquetas(etiquetasDe(plantilla), cargarMaestro(ctx), cargarGlosario(ctx), s.pais) : null

      const motivos = [
        formulario ? null : "formulario no generado",
        ...soportes.filter((x) => x.estado === "ausente").map((x) => `soporte ausente: ${x.tipo}`),
        ...soportes.filter((x) => x.estado === "vencido").map((x) => `soporte vencido: ${x.tipo} (${x.vigencia_hasta})`),
        exigidos.length ? null : "no se pudo leer la lista de soportes exigidos",
      ].filter((x): x is string => x !== null)
      const datos = { solicitud: s, fecha, formulario, soportes, mapeo, listo: motivos.length === 0, motivos }
      const proveedor = proveedorDelMaestro(ctx)
      const borrador = renderBorrador(datos, proveedor)
      const maestro = cargarMaestro(ctx)
      const bancarios = reglas.rutas_bancarias_detectables.map((r) => valorEnMaestro(maestro, r)).filter((v): v is string => typeof v === "string")
      if (contieneDatosBancarios(borrador, bancarios).length) throw new ErrorNegocio("el borrador de correo contiene datos bancarios; no se generó (RN2)")
      fs.writeFileSync(path.join(paquete, "borrador-correo.md"), borrador)
      fs.writeFileSync(path.join(paquete, "checklist.md"), renderChecklist(datos))
      fs.writeFileSync(path.join(salida, "estado.json"), JSON.stringify({ listo_para_firma: datos.listo, motivos, fecha }, null, 2))

      const de = (e: string) => soportes.filter((x) => x.estado === e).map((x) => x.tipo)
      return {
        ruta: relativa(ctx, paquete) + "/", listo_para_firma: datos.listo, fecha_ejecucion: fecha,
        checklist: {
          formulario, presentes: de("presente"), ausentes: de("ausente"), vencidos: de("vencido"), soportes,
          campos_faltantes: mapeo?.faltantes.map((f) => f.etiqueta) ?? [],
          campos_por_confirmar: mapeo?.requiere_confirmacion.map((c) => c.etiqueta) ?? [],
          motivos_bloqueo: motivos,
        },
        archivos: fs.readdirSync(paquete).sort(), advertencias,
        resumen: `listo_para_firma=${datos.listo}${motivos.length ? ` (${motivos.join("; ")})` : ""}`,
      }
    })
  },
}

// ───────────────────────────────────────────── RN4
export const simular_envio = {
  description: "Simula el envío del paquete escribiendo out/<caso>/ENVIO-SIMULADO.md; exige confirmación explícita del usuario.",
  args: {
    caso,
    confirmado: z.boolean().describe("true solo si el último mensaje del usuario confirmó explícitamente el envío de este caso"),
  },
  async execute(args: { caso: string; confirmado: boolean }, ctx: Ctx): Promise<string> {
    return responder(() => {
      if (!args.confirmado) throw new ErrorNegocio("requiere confirmación explícita")
      const s = cargarSolicitud(ctx, args.caso)
      const salida = dirSalida(ctx, args.caso)
      const rutaEstado = path.join(salida, "estado.json")
      if (!fs.existsSync(rutaEstado)) throw new ErrorNegocio("primero hay que armar el paquete (proveedor_armar_paquete)")
      const destino = path.join(salida, "ENVIO-SIMULADO.md")
      if (fs.existsSync(destino)) throw new ErrorNegocio("este paquete ya tiene un envío simulado; vuelve a armar el paquete para reenviarlo")
      const estado = z.object({ listo_para_firma: z.boolean(), motivos: z.array(z.string()) }).parse(JSON.parse(fs.readFileSync(rutaEstado, "utf8")))
      const adjuntos = fs.readdirSync(path.join(salida, "paquete")).filter((a) => a !== "checklist.md" && a !== "borrador-correo.md").sort()
      fs.writeFileSync(destino, [
        "# ENVÍO SIMULADO", "",
        "> No se envió ningún correo ni se cargó nada en portales. Este archivo solo registra la decisión humana.", "",
        `- Fecha: ${new Date().toISOString()}`,
        `- Para: ${s.de}`,
        `- Asunto: RE: ${s.asunto}`,
        `- Cuerpo: paquete/borrador-correo.md`,
        `- Adjuntos: ${adjuntos.join(", ")}`,
        `- Listo para firma al momento del envío: ${estado.listo_para_firma ? "SÍ" : `NO (${estado.motivos.join("; ")})`}`,
        "",
      ].join("\n"))
      return { ruta: relativa(ctx, destino), listo_para_firma: estado.listo_para_firma, resumen: `envío simulado registrado en ${relativa(ctx, destino)}` }
    })
  },
}
