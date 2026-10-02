import { normalizar } from "./normalizar";

export interface ResultadoDeteccion {
  encontrado: boolean;
  hallazgos: string[];
}

/**
 * RN2: detecta datos bancarios en un texto (borrador de correo).
 * Detecta VALORES, no etiquetas: mencionar "Número de cuenta" como campo pendiente no es una fuga.
 *  1. Cualquier valor bancario del maestro (comparando también solo dígitos).
 *  2. Palabra clave bancaria seguida de una secuencia numérica de 6+ dígitos.
 *  3. Patrón IBAN.
 */
export function detectarDatosBancarios(texto: string, valoresBancarios: string[] = []): ResultadoDeteccion {
  const hallazgos: string[] = [];
  const textoNorm = normalizar(texto);
  const textoDigitos = texto.replace(/\D/g, "");

  for (const valor of valoresBancarios) {
    if (!valor) continue;
    const digitos = valor.replace(/\D/g, "");
    if (digitos.length >= 6 && textoDigitos.includes(digitos)) hallazgos.push("valor de cuenta del maestro");
    else if (digitos.length < 6 && valor.length > 3 && textoNorm.includes(normalizar(valor)) && /\d/.test(valor)) {
      hallazgos.push("valor bancario del maestro");
    }
  }

  const claveConNumero = /(cuenta|iban|swift|bic|cci|aba|routing)[^\n]{0,40}?\d[\d\s.-]{5,}\d/i;
  const m = texto.match(claveConNumero);
  if (m) hallazgos.push(`patrón de cuenta: "${m[0].slice(0, 60)}"`);

  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/.test(texto)) hallazgos.push("patrón IBAN");

  return { encontrado: hallazgos.length > 0, hallazgos: [...new Set(hallazgos)] };
}
