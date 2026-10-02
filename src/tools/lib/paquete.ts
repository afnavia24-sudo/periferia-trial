import type { Solicitud, SoporteRepositorio } from "./fixtures"
import type { Mapeo } from "./mapeo"

export type EstadoSoporte = "presente" | "vencido" | "ausente"

export interface SoporteEvaluado {
  tipo: string
  descripcion: string
  estado: EstadoSoporte
  vigencia_hasta: string | null
  archivo: string | null
  observacion: string | null
}

/** RN3: vencido si vigencia_hasta es anterior a la fecha de ejecución. null = sin vencimiento. */
export function evaluarSoporte(tipo: string, indice: SoporteRepositorio[], existeArchivo: (archivo: string) => boolean, fecha: string, paisCliente: string): SoporteEvaluado {
  const s = indice.find((x) => x.tipo === tipo)
  if (!s) return { tipo, descripcion: tipo, estado: "ausente", vigencia_hasta: null, archivo: null, observacion: "No existe en el repositorio de soportes" }
  const descripcion = s.descripcion ?? tipo
  if (!existeArchivo(s.archivo)) return { tipo, descripcion, estado: "ausente", vigencia_hasta: s.vigencia_hasta, archivo: null, observacion: `Archivo ${s.archivo} no encontrado` }
  const vencido = s.vigencia_hasta !== null && s.vigencia_hasta < fecha
  const extranjero = s.pais_emisor !== paisCliente ? `Emitido en ${s.pais_emisor}: confirmar que el cliente (${paisCliente}) lo acepta` : null
  const obs = [vencido ? `Venció el ${s.vigencia_hasta}: solicitar uno nuevo` : null, extranjero].filter(Boolean).join(". ")
  return { tipo, descripcion, estado: vencido ? "vencido" : "presente", vigencia_hasta: s.vigencia_hasta, archivo: s.archivo, observacion: obs || null }
}

export interface DatosChecklist {
  solicitud: Solicitud
  fecha: string
  formulario: string | null
  soportes: SoporteEvaluado[]
  mapeo: Mapeo | null
  listo: boolean
  motivos: string[]
}

export function renderChecklist(d: DatosChecklist): string {
  const marca = (b: boolean) => (b ? "[x]" : "[ ]")
  const icono: Record<EstadoSoporte, string> = { presente: "✅ presente", vencido: "⛔ vencido", ausente: "❌ ausente" }
  const faltantes = d.mapeo?.faltantes ?? []
  const porConfirmar = d.mapeo?.requiere_confirmacion ?? []
  return [
    `# Checklist · ${d.solicitud.id}`,
    "",
    `- Cliente: ${d.solicitud.cliente} (${d.solicitud.pais})`,
    `- Formato: ${d.solicitud.formato}`,
    `- Fecha de ejecución: ${d.fecha}`,
    `- **Listo para firma: ${d.listo ? "SÍ" : "NO"}**${d.motivos.length ? ` (${d.motivos.join("; ")})` : ""}`,
    "",
    "## Formulario",
    "",
    `- ${marca(d.formulario !== null)} ${d.formulario ?? "no generado"}`,
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Estado | Vigencia hasta | Observación |",
    "|---|---|---|---|",
    ...d.soportes.map((s) => `| ${s.descripcion === s.tipo ? `\`${s.tipo}\`` : `${s.descripcion} (\`${s.tipo}\`)`} | ${icono[s.estado]} | ${s.vigencia_hasta ?? "no aplica"} | ${s.observacion ?? ""} |`),
    "",
    "## Campos faltantes (no bloquean la firma)",
    "",
    ...(faltantes.length ? faltantes.map((f) => `- ${f.etiqueta}: ${f.motivo}`) : ["- Ninguno"]),
    "",
    "## Campos por confirmar",
    "",
    ...(porConfirmar.length ? porConfirmar.map((c) => `- ${c.etiqueta}: ${c.motivo}`) : ["- Ninguno"]),
    "",
    "## Pasos humanos",
    "",
    "- [ ] Revisar campos faltantes y por confirmar",
    "- [ ] Actualizar soportes vencidos o ausentes",
    "- [ ] Firma del representante legal",
    "- [ ] Aprobar el borrador de correo y autorizar el envío",
    "",
  ].join("\n")
}

/** Borrador de respuesta al cliente. Se construye sin datos bancarios (RN2). */
export function renderBorrador(d: DatosChecklist, proveedor: string): string {
  const adjuntos = [
    d.formulario ? `Formulario diligenciado y firmado (${d.formulario.split("/").pop()})` : null,
    ...d.soportes.filter((s) => s.estado === "presente").map((s) => s.descripcion),
  ].filter((x): x is string => x !== null)
  const pendientes = d.mapeo?.faltantes.map((f) => f.etiqueta) ?? []
  const avisoInterno = d.listo ? [] : [
    `> ⚠️ NOTA INTERNA (borrar antes de enviar): el paquete no está listo para firma: ${d.motivos.join("; ")}.`,
    "",
  ]
  return [
    "# Borrador de correo (requiere revisión humana)",
    "",
    ...avisoInterno,
    `**Para:** ${d.solicitud.de}`,
    `**Asunto:** RE: ${d.solicitud.asunto}`,
    "",
    "Buen día,",
    "",
    `En respuesta a su solicitud del ${d.solicitud.fecha}, adjuntamos la documentación para el registro de ${proveedor} como proveedor de ${d.solicitud.cliente}:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    ...(pendientes.length ? ["Los siguientes datos del formulario quedan pendientes y se los haremos llegar por separado:", "", ...pendientes.map((p) => `- ${p}`), ""] : []),
    "Quedamos atentos a cualquier inquietud.",
    "",
    "Cordialmente,",
    "",
    proveedor,
    "",
  ].join("\n")
}

/** Segunda barrera de RN2: detecta valores bancarios del maestro dentro de un texto. */
export function contieneDatosBancarios(texto: string, valoresBancarios: string[]): string[] {
  const digitos = texto.replace(/\D/g, "")
  return valoresBancarios.filter((v) => {
    const d = v.replace(/\D/g, "")
    return d.length >= 6 ? digitos.includes(d) : v.length >= 6 && texto.includes(v)
  })
}
