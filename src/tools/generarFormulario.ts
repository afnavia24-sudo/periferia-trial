import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { ToolError } from "../lib/errores";
import { cargarSolicitud, dirCaso, dirPaquete, leerJsonSiExiste, rel } from "../lib/repositorio";
import type { FilaMapeo, MapeoPersistido } from "./mapearCampos";

const ETIQUETA_ESTADO: Record<FilaMapeo["estado"], string> = {
  lleno: "Lleno",
  faltante: "FALTANTE",
  requiere_confirmacion: "Requiere confirmación",
};

export function cargarMapeo(caso: string): MapeoPersistido {
  const mapeo = leerJsonSiExiste<MapeoPersistido>(path.join(dirCaso(caso), "mapeo.json"));
  if (!mapeo) throw new ToolError("MAPEO_NO_EJECUTADO", `Ejecuta proveedor_mapear_campos antes de generar el formulario de ${caso}`);
  return mapeo;
}

async function generarXlsx(mapeo: MapeoPersistido, ruta: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perixia 2.0";
  const ws = wb.addWorksheet("Registro proveedor");
  const fuente = { name: "Arial", size: 10 };
  ws.columns = [{ width: 32 }, { width: 42 }, { width: 22 }, { width: 58 }];

  ws.addRow(["Formulario de registro como proveedor"]).font = { ...fuente, size: 14, bold: true };
  ws.addRow(["Proveedor", "Periferia IT Group"]).font = fuente;
  ws.addRow(["Cliente", mapeo.cliente]).font = fuente;
  ws.addRow(["País del cliente", mapeo.pais]).font = fuente;
  ws.addRow(["Generado", mapeo.generado_en]).font = fuente;
  ws.addRow([]);
  const leyenda = ws.addRow(["Leyenda: filas en amarillo = campo faltante (completar antes de firmar); naranja = requiere confirmación."]);
  leyenda.font = { ...fuente, italic: true };
  ws.addRow([]);

  const encabezado = ws.addRow(["Campo solicitado", "Valor", "Estado", "Observación"]);
  encabezado.eachCell((c) => {
    c.font = { ...fuente, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  });

  for (const f of mapeo.filas) {
    const fila = ws.addRow([f.campo, f.valor ?? "", ETIQUETA_ESTADO[f.estado], f.observacion ?? ""]);
    fila.font = fuente;
    const color = f.estado === "faltante" ? "FFFFFF00" : f.estado === "requiere_confirmacion" ? "FFFCE4D6" : null;
    if (color) fila.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }));
  }
  await wb.xlsx.writeFile(ruta);
}

function generarPdf(mapeo: MapeoPersistido, ruta: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50, info: { Title: `Registro proveedor - ${mapeo.cliente}` } });
    const stream = fs.createWriteStream(ruta);
    stream.on("finish", resolve).on("error", reject);
    doc.pipe(stream);

    doc.font("Helvetica-Bold").fontSize(15).text("Formulario de registro como proveedor");
    doc.moveDown(0.5).font("Helvetica").fontSize(10);
    doc.text(`Proveedor: Periferia IT Group`);
    doc.text(`Cliente: ${mapeo.cliente}`);
    doc.text(`País del cliente: ${mapeo.pais}`);
    doc.text(`Generado: ${mapeo.generado_en}`);
    doc.moveDown();

    const x = [50, 210, 370, 450];
    const anchos = [155, 155, 75, 112];
    const fila = (celdas: string[], negrita = false) => {
      doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      const alto = Math.max(...celdas.map((c, i) => doc.heightOfString(c || " ", { width: anchos[i] }))) + 6;
      if (doc.y + alto > doc.page.height - 50) doc.addPage();
      const y = doc.y;
      celdas.forEach((c, i) => doc.text(c || " ", x[i], y + 3, { width: anchos[i] }));
      doc.moveTo(50, y + alto).lineTo(562, y + alto).strokeColor("#bbbbbb").stroke();
      doc.x = 50;
      doc.y = y + alto;
    };
    fila(["Campo solicitado", "Valor", "Estado", "Observación"], true);
    for (const f of mapeo.filas) fila([f.campo, f.valor ?? "", ETIQUETA_ESTADO[f.estado], f.observacion ?? ""]);
    doc.end();
  });
}

export async function proveedorGenerarFormulario(input: { caso: string; formato: string }) {
  if (input.formato !== "xlsx" && input.formato !== "pdf") {
    throw new ToolError("FORMATO_NO_SOPORTADO", `formato no soportado para generación automática: ${input.formato}`);
  }
  const solicitud = cargarSolicitud(input.caso);
  if (solicitud.formato !== input.formato) {
    throw new ToolError("FORMATO_NO_COINCIDE", `La solicitud pide ${solicitud.formato}, no ${input.formato}`);
  }
  const mapeo = cargarMapeo(input.caso);
  fs.mkdirSync(dirPaquete(input.caso), { recursive: true });
  const ruta = path.join(dirPaquete(input.caso), `formulario-registro.${input.formato}`);
  if (input.formato === "xlsx") await generarXlsx(mapeo, ruta);
  else await generarPdf(mapeo, ruta);
  return { caso: input.caso, formato: input.formato, ruta_formulario: rel(ruta), filas: mapeo.filas.length };
}
