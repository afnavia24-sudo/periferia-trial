export const ETIQUETA_TRIBUTARIA = { CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" } as const;
export type CodigoPais = keyof typeof ETIQUETA_TRIBUTARIA;
export const FORMATOS = ["xlsx", "pdf", "portal"] as const;
export type Formato = (typeof FORMATOS)[number];

export function esPaisSoportado(p: unknown): p is CodigoPais {
  return typeof p === "string" && p in ETIQUETA_TRIBUTARIA;
}
export function esFormatoSoportado(f: unknown): f is Formato {
  return typeof f === "string" && (FORMATOS as readonly string[]).includes(f);
}
export function observacionIdentificadorExtranjero(pais: CodigoPais): string {
  return `Identificador extranjero (NIT colombiano asignado a campo de ${ETIQUETA_TRIBUTARIA[pais]})`;
}
