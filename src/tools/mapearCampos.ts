import path from "node:path";
import { ToolError } from "../lib/errores";
import { enmascarar, normalizar } from "../lib/normalizar";
import { ETIQUETA_TRIBUTARIA, esPaisSoportado, observacionIdentificadorExtranjero } from "../lib/paises";
import { cargarGlosario, cargarMaestro, cargarSolicitud, dirCaso, guardarJson, type EntradaGlosario } from "../lib/repositorio";

export type EstadoFila = "lleno" | "faltante" | "requiere_confirmacion";

export interface FilaMapeo {
  campo: string;
  canonico: string | null;
  valor: string | null;
  estado: EstadoFila;
  es_bancario: boolean;
  observacion: string | null;
}

export interface MapeoPersistido {
  caso: string;
  cliente: string;
  pais: string;
  formato: string;
  etiqueta_identificador: string;
  generado_en: string;
  filas: FilaMapeo[];
}

export function resolverCanonico(etiqueta: string, glosario: Record<string, EntradaGlosario>): string | null {
  const n = normalizar(etiqueta);
  for (const [canonico, entrada] of Object.entries(glosario)) {
    if (normalizar(canonico.replace(/_/g, " ")) === n) return canonico;
    if (entrada.sinonimos.some((s) => normalizar(s) === n)) return canonico;
  }
  return null;
}

export async function proveedorMapearCampos(input: { caso: string; campos?: string[] }) {
  const solicitud = cargarSolicitud(input.caso);
  if (!esPaisSoportado(solicitud.pais)) {
    throw new ToolError("PAIS_NO_SOPORTADO", `país no soportado: ${solicitud.pais}`);
  }
  const pais = solicitud.pais;
  const campos = input.campos?.length ? input.campos : solicitud.campos;
  const glosario = cargarGlosario();
  const maestro = cargarMaestro();

  const filas: FilaMapeo[] = campos.map((campo) => {
    const canonico = resolverCanonico(campo, glosario);
    if (!canonico) {
      return { campo, canonico: null, valor: null, estado: "faltante", es_bancario: false, observacion: "sin equivalente en el glosario" };
    }
    const entrada = glosario[canonico];
    const valor = maestro[entrada.maestro];
    const es_bancario = Boolean(entrada.bancario);
    if (valor == null || valor === "") {
      return { campo, canonico, valor: null, estado: "faltante", es_bancario, observacion: "sin valor en el repositorio maestro" };
    }
    if (entrada.tributario && pais !== "CO") {
      return { campo, canonico, valor, estado: "requiere_confirmacion", es_bancario, observacion: observacionIdentificadorExtranjero(pais) };
    }
    return { campo, canonico, valor, estado: "lleno", es_bancario, observacion: null };
  });

  const persistido: MapeoPersistido = {
    caso: solicitud.caso,
    cliente: solicitud.cliente,
    pais,
    formato: solicitud.formato,
    etiqueta_identificador: ETIQUETA_TRIBUTARIA[pais],
    generado_en: new Date().toISOString(),
    filas,
  };
  // El archivo en disco guarda los valores completos: lo consume el generador de formularios.
  guardarJson(path.join(dirCaso(solicitud.caso), "mapeo.json"), persistido);

  // Al modelo solo le llegan valores bancarios enmascarados (defensa en profundidad para RN2).
  const visible = (f: FilaMapeo) => ({ ...f, valor: f.valor && f.es_bancario ? enmascarar(f.valor) : f.valor });
  const asignados = filas.filter((f) => f.estado !== "faltante");
  return {
    caso: solicitud.caso,
    pais,
    etiqueta_identificador: ETIQUETA_TRIBUTARIA[pais],
    llenos: asignados.map(visible),
    faltantes: filas.filter((f) => f.estado === "faltante").map((f) => ({ campo: f.campo, motivo: f.observacion })),
    requiere_confirmacion: filas.filter((f) => f.estado === "requiere_confirmacion").map((f) => ({ campo: f.campo, observacion: f.observacion })),
    nota: "Los valores bancarios se muestran enmascarados; el formulario usa los valores completos.",
  };
}
