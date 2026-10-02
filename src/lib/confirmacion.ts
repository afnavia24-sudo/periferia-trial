import { normalizar } from "./normalizar";

export interface ResultadoConfirmacion {
  valida: boolean;
  motivo: string;
}

const AUTORIZACION = /\b(autorizo|autorizamos|confirmo|confirmamos|apruebo|procede|procedan|proceder)\b/;
const OBJETO_ENVIO = /\b(envio|enviar|envia|envialo|enviarlo|envie|envien|enviado)\b/;
const SI_ENVIA = /^si\s+(envia|envialo|enviar|procede)\b/;
const CONDICIONES = /\b(pero|cambia|cambiar|cambien|modifica|modificar|actualiza|actualizar|corrige|corregir|excepto|salvo|antes de|primero)\b/;

/**
 * RN4: una confirmación es válida solo si autoriza el envío de forma inequívoca y sin condiciones.
 * Es una guardia determinista en código: complementa (no reemplaza) la instrucción del prompt.
 */
export function esConfirmacionExplicita(mensaje: string): ResultadoConfirmacion {
  if (mensaje.includes("?")) return { valida: false, motivo: "el mensaje contiene una pregunta" };
  const t = normalizar(mensaje);
  if (!t) return { valida: false, motivo: "mensaje vacío o sin texto" };
  if (/^(no|nop|todavia no|aun no)\b/.test(t) || /\bno (autorizo|envies|enviar|confirmo)\b/.test(t)) {
    return { valida: false, motivo: "el mensaje niega la autorización" };
  }
  if (CONDICIONES.test(t)) return { valida: false, motivo: "el mensaje incluye cambios o condiciones" };
  const autoriza = (AUTORIZACION.test(t) && OBJETO_ENVIO.test(t)) || SI_ENVIA.test(t);
  if (!autoriza) return { valida: false, motivo: "no hay una autorización explícita del envío" };
  return { valida: true, motivo: "confirmación explícita" };
}

/** Marcador de la pregunta de confirmación (plantilla 5.2 del prompt). Devuelve el caso al que se refiere. */
export function extraerCasoDeConfirmacion(textoAgente: string): string | null {
  const t = textoAgente.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!t.includes("autorizas la simulacion del envio")) return null;
  const m = t.match(/autorizas la simulacion del envio[^\n]*?caso\s+[`'"*]*([a-z0-9][a-z0-9-]+)/);
  return m ? m[1] : null;
}
