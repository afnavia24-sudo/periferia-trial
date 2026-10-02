import path from "node:path";

export const DATA_DIR = path.resolve(process.env.PERIXIA_DATA_DIR ?? "data");
export const OUT_DIR = path.resolve(process.env.PERIXIA_OUT_DIR ?? "out");
export const MODELO = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
export const ZONA_HORARIA = "America/Bogota";

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de corte para evaluar vigencias (YYYY-MM-DD). FECHA_EVALUACION la fija para pruebas reproducibles. */
export function fechaEvaluacion(): string {
  const forzada = process.env.FECHA_EVALUACION;
  if (forzada) {
    if (!FECHA_ISO.test(forzada)) throw new Error(`FECHA_EVALUACION inválida: ${forzada}`);
    return forzada;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA }).format(new Date());
}

/** Fecha y hora legibles en la zona de Bogotá, p. ej. "2026-10-01 22:20 (America/Bogota)". */
export function fechaHoraLocal(iso: string | Date = new Date()): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_HORARIA, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${f} ${h} (${ZONA_HORARIA})`;
}
