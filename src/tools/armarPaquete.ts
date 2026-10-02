import fs from "node:fs";
import path from "node:path";
import { fechaEvaluacion } from "../config";
import { detectarDatosBancarios } from "../lib/bancarios";
import { ToolError } from "../lib/errores";
import {
  cargarMaestro, cargarSolicitud, cargarSoportes, dirCaso, dirPaquete, guardarJson, rel,
  rutaArchivoSoporte, valoresBancariosMaestro, type Solicitud,
} from "../lib/repositorio";
import { evaluarVigencia, type EstadoSoporte } from "../lib/vigencia";
import { cargarMapeo } from "./generarFormulario";
import type { MapeoPersistido } from "./mapearCampos";

export interface SoporteEvaluado {
  nombre: string;
  estado: EstadoSoporte;
  vigencia_hasta: string | null;
  archivo: string | null;
  motivo: string | null;
}

export interface EstadoPaquete {
  caso: string;
  formato: string;
  fecha_evaluacion: string;
  listo_para_firma: boolean;
  validacion_borrador: { ok: boolean; hallazgos: string[] };
  apto_para_envio: boolean;
  motivos_bloqueo: string[];
  destinatario: string | null;
}

function evaluarSoportes(solicitud: Solicitud, fecha: string, destino: string): SoporteEvaluado[] {
  const catalogo = cargarSoportes();
  return solicitud.soportes_exigidos.map((nombre) => {
    const s = catalogo.find((c) => c.nombre === nombre);
    if (!s) return { nombre, estado: "ausente", vigencia_hasta: null, archivo: null, motivo: "no existe en el repositorio de soportes" };
    const origen = rutaArchivoSoporte(s);
    const existe = fs.existsSync(origen);
    const estado = evaluarVigencia({ existe, vigenciaHasta: s.vigencia_hasta, fechaEvaluacion: fecha });
    let archivo: string | null = null;
    if (existe) {
      fs.mkdirSync(destino, { recursive: true });
      const copia = path.join(destino, path.basename(origen));
      fs.copyFileSync(origen, copia);
      archivo = rel(copia);
    }
    const motivo = !existe ? "archivo no encontrado" : estado === "vencido" ? `vencido el ${s.vigencia_hasta}` : null;
    return { nombre, estado, vigencia_hasta: s.vigencia_hasta, archivo, motivo };
  });
}

function redactarBorrador(solicitud: Solicitud, mapeo: MapeoPersistido, soportes: SoporteEvaluado[]): string {
  const maestro = cargarMaestro();
  const contacto = solicitud.contacto_cliente ?? {};
  const faltantes = mapeo.filas.filter((f) => f.estado === "faltante").map((f) => f.campo);
  const adjuntos = [
    solicitud.formato === "portal" ? null : `Formulario de registro diligenciado (${solicitud.formato.toUpperCase()})`,
    ...soportes.filter((s) => s.estado === "vigente").map((s) => `Soporte: ${s.nombre}`),
  ].filter(Boolean);

  // RN2: este texto se construye solo con datos NO bancarios. La validación posterior es una segunda barrera.
  return [
    "# Borrador de correo (pendiente de revisión humana)",
    "",
    `**Para:** ${contacto.correo ?? "[faltante: correo del contacto del cliente]"}`,
    `**Asunto:** Registro como proveedor - ${maestro.razon_social} - ${solicitud.cliente}`,
    "",
    `Estimado/a ${contacto.nombre ?? `equipo de ${solicitud.cliente}`}:`,
    "",
    `En atención a su solicitud, adjuntamos la documentación para el registro de ${maestro.razon_social} como proveedor de ${solicitud.cliente}:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    ...(faltantes.length
      ? ["Los siguientes campos quedan pendientes y los remitiremos a la mayor brevedad:", "", ...faltantes.map((f) => `- ${f}`), ""]
      : []),
    "Quedamos atentos a cualquier observación.",
    "",
    "Cordialmente,",
    "",
    String(maestro.razon_social),
    String(maestro.correo_contacto ?? ""),
    "",
  ].join("\n");
}

function redactarChecklist(solicitud: Solicitud, mapeo: MapeoPersistido, soportes: SoporteEvaluado[], estado: EstadoPaquete): string {
  const icono = (b: boolean) => (b ? "✅" : "❌");
  const lineasCampos = mapeo.filas.map(
    (f) => `| ${f.campo} | ${f.estado} | ${f.observacion ?? ""} |`,
  );
  const lineasSoportes = soportes.map(
    (s) => `| ${s.nombre} | ${s.estado} | ${s.vigencia_hasta ?? "sin vencimiento"} | ${s.motivo ?? ""} |`,
  );
  return [
    `# Checklist - ${solicitud.caso}`,
    "",
    `- Cliente: ${solicitud.cliente} (${solicitud.pais})`,
    `- Formato: ${solicitud.formato}`,
    `- Fecha de evaluación de vigencia: ${estado.fecha_evaluacion}`,
    `- ${icono(estado.listo_para_firma)} Listo para firma`,
    `- ${icono(estado.validacion_borrador.ok)} Borrador de correo sin datos bancarios`,
    `- ${icono(estado.apto_para_envio)} Apto para envío simulado${estado.motivos_bloqueo.length ? `: ${estado.motivos_bloqueo.join("; ")}` : ""}`,
    "",
    "## Campos",
    "",
    "| Campo | Estado | Observación |",
    "|---|---|---|",
    ...lineasCampos,
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Estado | Vigencia hasta | Observación |",
    "|---|---|---|---|",
    ...lineasSoportes,
    "",
    "## Pasos humanos pendientes",
    "",
    "- [ ] Revisar el formulario y los campos marcados como faltantes o por confirmar",
    "- [ ] Firmar el formulario",
    "- [ ] Revisar y aprobar el borrador de correo",
    solicitud.formato === "portal" ? "- [ ] Cargar manualmente los valores en el portal del cliente" : "- [ ] Autorizar el envío",
    "",
  ].join("\n");
}

export async function proveedorArmarPaquete(input: { caso: string }) {
  const solicitud = cargarSolicitud(input.caso);
  const mapeo = cargarMapeo(input.caso);
  const paquete = dirPaquete(input.caso);
  if (solicitud.formato !== "portal") {
    const formulario = path.join(paquete, `formulario-registro.${solicitud.formato}`);
    if (!fs.existsSync(formulario)) {
      throw new ToolError("FORMULARIO_NO_GENERADO", `Ejecuta proveedor_generar_formulario antes de armar el paquete de ${input.caso}`);
    }
  }
  fs.mkdirSync(paquete, { recursive: true });

  const fecha = fechaEvaluacion();
  const soportes = evaluarSoportes(solicitud, fecha, path.join(paquete, "soportes"));
  const listo = soportes.every((s) => s.estado === "vigente");

  const borrador = redactarBorrador(solicitud, mapeo, soportes);
  const deteccion = detectarDatosBancarios(borrador, valoresBancariosMaestro());

  const motivos: string[] = [];
  if (!listo) motivos.push("soportes ausentes o vencidos");
  if (deteccion.encontrado) motivos.push("el borrador de correo contiene datos bancarios");
  if (solicitud.formato === "portal") motivos.push("formato portal: la carga es manual");

  const estado: EstadoPaquete = {
    caso: solicitud.caso,
    formato: solicitud.formato,
    fecha_evaluacion: fecha,
    listo_para_firma: listo,
    validacion_borrador: { ok: !deteccion.encontrado, hallazgos: deteccion.hallazgos },
    apto_para_envio: motivos.length === 0,
    motivos_bloqueo: motivos,
    destinatario: solicitud.contacto_cliente?.correo ?? null,
  };

  const rutaBorrador = path.join(paquete, "borrador-correo.md");
  const rutaChecklist = path.join(paquete, "checklist.md");
  fs.writeFileSync(rutaBorrador, borrador, "utf8");
  fs.writeFileSync(rutaChecklist, redactarChecklist(solicitud, mapeo, soportes, estado), "utf8");
  guardarJson(path.join(dirCaso(input.caso), "estado.json"), estado);

  return {
    caso: solicitud.caso,
    ruta_paquete: rel(paquete) + "/",
    fecha_evaluacion: fecha,
    soportes,
    listo_para_firma: listo,
    validacion_borrador: estado.validacion_borrador,
    apto_para_envio: estado.apto_para_envio,
    motivos_bloqueo: motivos,
    ruta_checklist: rel(rutaChecklist),
    ruta_borrador: rel(rutaBorrador),
    borrador_correo: deteccion.encontrado ? "[OCULTO: el borrador contiene datos bancarios]" : borrador,
  };
}
