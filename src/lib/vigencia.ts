export type EstadoSoporte = "vigente" | "vencido" | "ausente";

/** RN3: vigente si vigencia_hasta >= fecha de evaluación (el mismo día sigue vigente). null = sin vencimiento. */
export function evaluarVigencia(opts: {
  existe: boolean;
  vigenciaHasta: string | null | undefined;
  fechaEvaluacion: string;
}): EstadoSoporte {
  if (!opts.existe) return "ausente";
  if (opts.vigenciaHasta == null) return "vigente";
  return opts.vigenciaHasta >= opts.fechaEvaluacion ? "vigente" : "vencido";
}
