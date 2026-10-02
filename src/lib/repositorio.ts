import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, OUT_DIR } from "../config";
import { ToolError } from "./errores";
import type { CodigoPais, Formato } from "./paises";

export interface Solicitud {
  caso: string;
  cliente: string;
  pais: CodigoPais | string;
  formato: Formato | string;
  campos: string[];
  soportes_exigidos: string[];
  contacto_cliente?: { nombre?: string | null; correo?: string | null };
  observaciones?: string;
}

export interface EntradaGlosario {
  maestro: string;
  sinonimos: string[];
  bancario?: boolean;
  tributario?: boolean;
}

export interface Soporte {
  nombre: string;
  descripcion?: string;
  archivo: string;
  vigencia_hasta: string | null;
}

const CASO_VALIDO = /^[a-z0-9][a-z0-9-]{1,80}$/;

export function validarCaso(caso: unknown): string {
  if (typeof caso !== "string" || !CASO_VALIDO.test(caso)) {
    throw new ToolError("CASO_INVALIDO", `Identificador de caso inválido: ${JSON.stringify(caso)}`);
  }
  return caso;
}

function leerJson<T>(ruta: string): T {
  return JSON.parse(fs.readFileSync(ruta, "utf8")) as T;
}

export function cargarSolicitud(caso: string): Solicitud {
  validarCaso(caso);
  const ruta = path.join(DATA_DIR, "casos", caso, "solicitud.json");
  if (!fs.existsSync(ruta)) throw new ToolError("CASO_NO_ENCONTRADO", `caso no encontrado: ${caso}`);
  let s: Solicitud;
  try {
    s = leerJson<Solicitud>(ruta);
  } catch {
    throw new ToolError("SOLICITUD_MALFORMADA", `solicitud.json no es un JSON válido para ${caso}`);
  }
  const faltan = (["cliente", "pais", "formato", "campos", "soportes_exigidos"] as const).filter((k) => s[k] == null);
  if (faltan.length || !Array.isArray(s.campos) || !Array.isArray(s.soportes_exigidos)) {
    throw new ToolError("SOLICITUD_MALFORMADA", `solicitud.json incompleta para ${caso}`, { faltan });
  }
  return { ...s, caso };
}

export const cargarMaestro = () => leerJson<Record<string, string | null>>(path.join(DATA_DIR, "maestro.json"));
export const cargarGlosario = () => leerJson<{ campos: Record<string, EntradaGlosario> }>(path.join(DATA_DIR, "glosario.json")).campos;
export const cargarSoportes = () => leerJson<{ soportes: Soporte[] }>(path.join(DATA_DIR, "soportes.json")).soportes;
export const rutaArchivoSoporte = (s: Soporte) => path.join(DATA_DIR, s.archivo);

/** Valores bancarios del maestro (para detectar fugas en el borrador). */
export function valoresBancariosMaestro(): string[] {
  const maestro = cargarMaestro();
  return Object.values(cargarGlosario())
    .filter((g) => g.bancario)
    .map((g) => maestro[g.maestro])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

export const dirCaso = (caso: string) => path.join(OUT_DIR, validarCaso(caso));
export const dirPaquete = (caso: string) => path.join(dirCaso(caso), "paquete");

export function guardarJson(ruta: string, datos: unknown) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2), "utf8");
}
export function leerJsonSiExiste<T>(ruta: string): T | null {
  return fs.existsSync(ruta) ? leerJson<T>(ruta) : null;
}
/** Ruta relativa al cwd, para reportar al usuario. */
export const rel = (p: string) => path.relative(process.cwd(), p) || p;
