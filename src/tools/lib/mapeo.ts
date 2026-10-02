import reglas from "../../knowledge/reglas.json"
import type { Maestro } from "./fixtures"

export type Valor = string | number | boolean

export interface CampoLleno {
  etiqueta: string
  ruta: string
  valor: Valor
  confianza: number
  bancario: boolean
  nota?: string
}
export interface CampoFaltante {
  etiqueta: string
  motivo: string
}
export interface CampoPorConfirmar {
  etiqueta: string
  ruta: string | null
  valor: Valor | null
  confianza: number
  bancario: boolean
  motivo: string
  /** true: se escribe en el formulario (regla de país). false: solo se sugiere (baja confianza). */
  se_escribe: boolean
}
export interface Mapeo {
  llenos: CampoLleno[]
  faltantes: CampoFaltante[]
  requiere_confirmacion: CampoPorConfirmar[]
}

const IDENTIFICADORES = new Set(Object.values(reglas.identificador_por_pais).map((e) => e.toLowerCase()))
const VACIAS = new Set(reglas.palabras_vacias)

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function tokens(texto: string): string[] {
  return normalizar(texto).split(" ").filter((t) => t && !VACIAS.has(t))
}

/** Dos palabras coinciden si son iguales o una es la otra con hasta 2 letras de más (singular/plural). */
function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a]
  return corta.length >= 4 && larga.startsWith(corta) && larga.length - corta.length <= 2
}

/** Similitud de Dice sobre palabras (0..1). */
export function similitud(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  const usadas = new Set<number>()
  let coincidencias = 0
  for (const x of ta) {
    const i = tb.findIndex((y, idx) => !usadas.has(idx) && mismaPalabra(x, y))
    if (i >= 0) {
      usadas.add(i)
      coincidencias++
    }
  }
  return (2 * coincidencias) / (ta.length + tb.length)
}

/** Busca la etiqueta en el glosario: coincidencia exacta normalizada (1.0) o la más parecida. */
export function resolverEtiqueta(etiqueta: string, glosario: Record<string, string>): { ruta: string; confianza: number; sinonimo: string } | null {
  const n = normalizar(etiqueta)
  let mejor: { ruta: string; confianza: number; sinonimo: string } | null = null
  for (const [sinonimo, ruta] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === n) return { ruta, confianza: 1, sinonimo }
    const s = similitud(etiqueta, sinonimo)
    if (!mejor || s > mejor.confianza) mejor = { ruta, confianza: Math.round(s * 100) / 100, sinonimo }
  }
  return mejor
}

/** Lee un valor del maestro por ruta con puntos. Solo devuelve valores primitivos (o listas de primitivos unidas). */
export function valorEnMaestro(maestro: Maestro, ruta: string): Valor | undefined {
  let actual: unknown = maestro
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  if (typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean") return actual
  if (Array.isArray(actual) && actual.every((x) => typeof x === "string" || typeof x === "number")) return actual.join(", ")
  return undefined
}

/** Contexto que acompaña a un valor (p. ej. moneda y año de "ingresos_ultimo_ano.valor"). */
function notaDeContexto(maestro: Maestro, ruta: string): string | undefined {
  if (!ruta.endsWith(".valor")) return undefined
  const padre = ruta.slice(0, -".valor".length)
  const moneda = valorEnMaestro(maestro, `${padre}.moneda`)
  const ano = valorEnMaestro(maestro, `${padre}.ano`)
  const partes = [moneda !== undefined ? `moneda ${moneda}` : null, ano !== undefined ? `año ${ano}` : null].filter(Boolean)
  return partes.length ? partes.join(", ") : undefined
}

export const esBancario = (ruta: string) => ruta.startsWith(reglas.prefijo_datos_bancarios)

function etiquetaIdentificador(pais: string): string {
  const mapa: Record<string, string> = reglas.identificador_por_pais
  return mapa[pais] ?? "identificador tributario"
}

/** RN1: reglas del identificador tributario según el país del cliente. Devuelve el motivo si requiere confirmación. */
function motivoIdentificador(etiqueta: string, pais: string): string | null {
  const esperado = etiquetaIdentificador(pais)
  const n = normalizar(etiqueta)
  const generica = !IDENTIFICADORES.has(n)
  const motivos: string[] = []
  if (pais !== reglas.pais_base) motivos.push(`identificador extranjero (NIT colombiano asignado a campo de ${esperado})`)
  if (generica) motivos.push(`campo ambiguo: en ${pais} el equivalente es ${esperado}`)
  else if (n !== esperado.toLowerCase()) motivos.push(`la etiqueta ${etiqueta} no corresponde a ${pais}, donde se usa ${esperado}`)
  return motivos.length ? motivos.join("; ") : null
}

export function mapearEtiquetas(etiquetas: string[], maestro: Maestro, glosario: Record<string, string>, pais: string): Mapeo {
  const mapeo: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] }
  for (const etiqueta of etiquetas) {
    const r = resolverEtiqueta(etiqueta, glosario)
    if (!r || r.confianza < reglas.umbral_sugerencia) {
      mapeo.faltantes.push({ etiqueta, motivo: "sin equivalente en el glosario ni en el maestro" })
      continue
    }
    const valor = valorEnMaestro(maestro, r.ruta)
    if (valor === undefined) {
      mapeo.faltantes.push({ etiqueta, motivo: `la ruta "${r.ruta}" no existe en el maestro` })
      continue
    }
    const bancario = esBancario(r.ruta)
    if (r.confianza < reglas.umbral_confianza) {
      mapeo.requiere_confirmacion.push({
        etiqueta, ruta: r.ruta, valor, confianza: r.confianza, bancario, se_escribe: false,
        motivo: `mapeo con confianza ${r.confianza} (se parece a "${r.sinonimo}"); no se escribe hasta confirmar`,
      })
      continue
    }
    const motivoPais = r.ruta === reglas.ruta_identificador_tributario ? motivoIdentificador(etiqueta, pais) : null
    if (motivoPais) {
      mapeo.requiere_confirmacion.push({ etiqueta, ruta: r.ruta, valor, confianza: r.confianza, bancario, se_escribe: true, motivo: motivoPais })
      continue
    }
    const nota = notaDeContexto(maestro, r.ruta)
    mapeo.llenos.push({ etiqueta, ruta: r.ruta, valor, confianza: r.confianza, bancario, ...(nota ? { nota } : {}) })
  }
  return mapeo
}

/** Valor que se escribe en el formulario para una etiqueta, según el mapeo. null = queda vacío. */
export function valorParaFormulario(mapeo: Mapeo, etiqueta: string): { valor: Valor | null; estado: "lleno" | "faltante" | "requiere_confirmacion"; nota: string | null } {
  const lleno = mapeo.llenos.find((c) => c.etiqueta === etiqueta)
  if (lleno) return { valor: lleno.valor, estado: "lleno", nota: lleno.nota ?? null }
  const conf = mapeo.requiere_confirmacion.find((c) => c.etiqueta === etiqueta)
  if (conf) return { valor: conf.se_escribe ? conf.valor : null, estado: "requiere_confirmacion", nota: conf.motivo }
  const falt = mapeo.faltantes.find((c) => c.etiqueta === etiqueta)
  return { valor: null, estado: "faltante", nota: falt?.motivo ?? "no mapeado" }
}

export function enmascarar(valor: Valor): string {
  const s = String(valor)
  return s.length <= 4 ? "****" : `****${s.slice(-4)}`
}

/** Copia del mapeo apta para el modelo y el chat: oculta valores sensibles (RN2 y datos personales). */
export function mapeoParaChat(mapeo: Mapeo): Mapeo {
  const sensibles = new Set(reglas.rutas_enmascaradas_en_chat)
  const ocultar = <T extends { ruta: string | null; valor: Valor | null }>(c: T): T =>
    c.ruta && sensibles.has(c.ruta) && c.valor !== null ? { ...c, valor: enmascarar(c.valor) } : c
  return {
    llenos: mapeo.llenos.map(ocultar),
    faltantes: mapeo.faltantes,
    requiere_confirmacion: mapeo.requiere_confirmacion.map(ocultar),
  }
}
