/** Genera PDFs de ejemplo para los soportes declarados en data/soportes.json (solo para demo y pruebas). */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { cargarSoportes, rutaArchivoSoporte } from "../src/lib/repositorio";

for (const s of cargarSoportes()) {
  const ruta = rutaArchivoSoporte(s);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(ruta));
  doc.fontSize(16).text(`SOPORTE DE EJEMPLO: ${s.descripcion ?? s.nombre}`);
  doc.moveDown().fontSize(11).text(`Vigencia hasta: ${s.vigencia_hasta ?? "sin vencimiento"}`);
  doc.moveDown().text("Documento ficticio generado para pruebas. Reemplazar por el soporte real.");
  doc.end();
  console.log(`✔ ${path.relative(process.cwd(), ruta)}`);
}
