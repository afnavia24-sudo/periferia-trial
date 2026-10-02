/**
 * RN4 / CA3: decide si el mensaje del usuario es una confirmación explícita.
 * Es una guardia determinista del backend: no depende de que el modelo obedezca el prompt.
 */
export interface Confirmacion {
  valida: boolean
  motivo: string
}

const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9?\s]/g, " ").replace(/\s+/g, " ").trim()

const NEGACION = /^(no|nop|todavia no|aun no|espera|cancela|cancelar)\b|\bno (confirmo|autorizo|envies|enviar)\b/
const CONDICION = /\b(pero|cambia|cambiar|modifica|corrige|antes|primero|excepto|salvo|mejor no)\b/
const AFIRMACION = /^si\b|\b(confirmo|confirmado|autorizo|apruebo|procede|adelante)\b/

export function evaluarConfirmacion(mensaje: string): Confirmacion {
  const t = normalizar(mensaje)
  if (!t) return { valida: false, motivo: "mensaje vacío" }
  if (t.includes("?")) return { valida: false, motivo: "el mensaje es una pregunta" }
  if (NEGACION.test(t)) return { valida: false, motivo: "el usuario no autorizó" }
  if (CONDICION.test(t)) return { valida: false, motivo: "la respuesta incluye cambios o condiciones" }
  if (!AFIRMACION.test(t)) return { valida: false, motivo: "no es una confirmación explícita (p. ej. \"sí, confirmo el envío\")" }
  return { valida: true, motivo: "confirmación explícita" }
}
