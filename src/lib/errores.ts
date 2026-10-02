export type CodigoError =
  | "CASO_INVALIDO"
  | "CASO_NO_ENCONTRADO"
  | "SOLICITUD_MALFORMADA"
  | "PAIS_NO_SOPORTADO"
  | "FORMATO_NO_SOPORTADO"
  | "FORMATO_NO_COINCIDE"
  | "MAPEO_NO_EJECUTADO"
  | "FORMULARIO_NO_GENERADO"
  | "PAQUETE_NO_ARMADO"
  | "ENVIO_BLOQUEADO"
  | "ENVIO_DUPLICADO"
  | "MAESTRO_INCOMPLETO"
  | "BLOQUEADO_POR_POLITICA"
  | "HERRAMIENTA_DESCONOCIDA"
  | "MOCK_NO_DEFINIDO"
  | string;

export class ToolError extends Error {
  constructor(public codigo: CodigoError, mensaje: string, public detalle?: unknown) {
    super(mensaje);
    this.name = "ToolError";
  }
  toJSON() {
    return { error: this.codigo, mensaje: this.message, ...(this.detalle ? { detalle: this.detalle } : {}) };
  }
}
