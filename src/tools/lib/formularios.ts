import fs from "node:fs"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import type { Celda, CampoPlantilla, Plantilla, Solicitud } from "./fixtures"
import { valorParaFormulario, type Mapeo } from "./mapeo"

const AMARILLO = "FFFFF2CC"
const NARANJA = "FFFCE4D6"
const FUENTE = { name: "Arial", size: 10 }

export interface ResumenEscritura {
  escritos: number
  vacios: string[]
}

/** P0: escribe cada etiqueta y su valor exactamente en la hoja y celda que indica la plantilla. */
export async function escribirXlsx(items: Celda[], mapeo: Mapeo, ruta: string): Promise<ResumenEscritura> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Agente registro como proveedor"
  const vacios: string[] = []
  for (const item of items) {
    const hoja = wb.getWorksheet(item.hoja) ?? wb.addWorksheet(item.hoja)
    const { valor, estado, nota } = valorParaFormulario(mapeo, item.etiqueta)
    const etiqueta = hoja.getCell(item.celda_etiqueta)
    etiqueta.value = item.etiqueta
    etiqueta.font = { ...FUENTE, bold: true }
    const celda = hoja.getCell(item.celda_valor)
    celda.value = valor
    celda.font = FUENTE
    if (typeof valor === "number" && Math.abs(valor) >= 1000) celda.numFmt = "#,##0"
    if (estado !== "lleno") {
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: estado === "faltante" ? AMARILLO : NARANJA } }
      celda.note = `${estado === "faltante" ? "FALTANTE" : "POR CONFIRMAR"}: ${nota ?? ""}`
    } else if (nota) {
      celda.note = nota
    }
    if (valor === null) vacios.push(item.etiqueta)
    hoja.getColumn(etiqueta.col).width = Math.max(hoja.getColumn(etiqueta.col).width ?? 10, 34)
    hoja.getColumn(celda.col).width = Math.max(hoja.getColumn(celda.col).width ?? 10, 46)
  }
  await wb.xlsx.writeFile(ruta)
  return { escritos: items.length - vacios.length, vacios }
}

/** P1: PDF generado con todos los campos, etiqueta y valor, en el orden de la plantilla. */
export function escribirPdf(items: CampoPlantilla[], mapeo: Mapeo, solicitud: Solicitud, proveedor: string, ruta: string): Promise<ResumenEscritura> {
  return new Promise((resolve, reject) => {
    const vacios: string[] = []
    const doc = new PDFDocument({ size: "LETTER", margin: 56, info: { Title: `Formulario de proveedor - ${solicitud.cliente}` } })
    const stream = fs.createWriteStream(ruta)
    stream.on("finish", () => resolve({ escritos: items.length - vacios.length, vacios })).on("error", reject)
    doc.pipe(stream)
    doc.font("Helvetica-Bold").fontSize(14).text(`Formulario de registro de proveedor`)
    doc.font("Helvetica").fontSize(10).text(`Cliente: ${solicitud.cliente}  ·  Proveedor: ${proveedor}`)
    doc.fontSize(8).fillColor("#555555").text("* campo obligatorio según la plantilla del cliente").fillColor("black").moveDown()
    for (const item of items) {
      const { valor, estado, nota } = valorParaFormulario(mapeo, item.etiqueta)
      if (valor === null) vacios.push(item.etiqueta)
      doc.font("Helvetica-Bold").fontSize(9).text(`${item.etiqueta}${item.obligatorio ? " *" : ""}`)
      const texto = valor === null ? `[${estado === "faltante" ? "FALTANTE" : "POR CONFIRMAR"}] ${nota ?? ""}` : String(valor)
      doc.font("Helvetica").fontSize(10).fillColor(valor === null ? "#B45309" : "black").text(texto)
      if (valor !== null && estado === "requiere_confirmacion") doc.fontSize(8).fillColor("#B45309").text(`Por confirmar: ${nota ?? ""}`)
      doc.fillColor("black").moveDown(0.6)
    }
    doc.end()
  })
}

const celdaMd = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")

/** P2: valores listos para copiar en el portal del cliente. No se automatiza el portal. */
export function escribirValoresPortal(plantilla: Plantilla, mapeo: Mapeo, solicitud: Solicitud, ruta: string): ResumenEscritura {
  const vacios: string[] = []
  const filas = plantilla.items.map((item) => {
    const { valor, estado, nota } = valorParaFormulario(mapeo, item.etiqueta)
    if (valor === null) vacios.push(item.etiqueta)
    return `| ${celdaMd(item.etiqueta)} | ${valor === null ? "" : celdaMd(String(valor))} | ${estado} | ${celdaMd(nota ?? "")} |`
  })
  const urls = solicitud.cuerpo.match(/https?:\/\/\S+/g) ?? []
  const md = [
    `# Valores para el portal de ${solicitud.cliente}`,
    "",
    "> Formato no soportado en automatización directa: el portal lo opera una persona. Copia cada valor en el campo correspondiente.",
    "",
    urls.length ? `Portal indicado en la solicitud: ${urls.map((u) => u.replace(/[.,)]+$/, "")).join(", ")}` : "",
    "",
    "| Campo | Valor | Estado | Nota |",
    "|---|---|---|---|",
    ...filas,
    "",
    "## Pasos humanos",
    "",
    "1. Ingresar al portal con las credenciales que el cliente envió al representante legal. Las credenciales no se registran en este sistema.",
    "2. Copiar los valores de la tabla. Revisar antes los campos faltantes o por confirmar.",
    "3. Cargar los soportes del paquete.",
    "4. Revisar y hacer clic en \"Enviar\" en el portal.",
    "",
  ].join("\n")
  fs.writeFileSync(ruta, md, "utf8")
  return { escritos: plantilla.items.length - vacios.length, vacios }
}
