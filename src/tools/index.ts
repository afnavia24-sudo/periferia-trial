import type Anthropic from "@anthropic-ai/sdk";
import { ToolError } from "../lib/errores";
import { proveedorArmarPaquete } from "./armarPaquete";
import { proveedorGenerarFormulario } from "./generarFormulario";
import { proveedorLeerSolicitud } from "./leerSolicitud";
import { proveedorMapearCampos } from "./mapearCampos";
import { proveedorSimularEnvio } from "./simularEnvio";

export type NombreHerramienta =
  | "proveedor_leer_solicitud"
  | "proveedor_mapear_campos"
  | "proveedor_generar_formulario"
  | "proveedor_armar_paquete"
  | "proveedor_simular_envio";

/** Ejecuta una herramienta. Debe lanzar ToolError ante errores de negocio. Inyectable (real o mock). */
export type Ejecutor = (nombre: string, input: Record<string, unknown>) => Promise<unknown>;

const caso = { caso: { type: "string", description: "Identificador del caso, p. ej. 'ec-corp-andina'" } } as const;

export const DEFINICIONES: Anthropic.Tool[] = [
  {
    name: "proveedor_leer_solicitud",
    description: "Lee la solicitud del cliente: cliente, país, formato, campos y soportes exigidos.",
    input_schema: { type: "object", properties: { ...caso }, required: ["caso"] },
  },
  {
    name: "proveedor_mapear_campos",
    description: "Cruza los campos de la plantilla con el repositorio maestro usando el glosario. Marca faltantes y campos que requieren confirmación. Los valores bancarios se devuelven enmascarados.",
    input_schema: {
      type: "object",
      properties: { ...caso, campos: { type: "array", items: { type: "string" }, description: "Campos de la plantilla (opcional; por defecto, los de la solicitud)" } },
      required: ["caso"],
    },
  },
  {
    name: "proveedor_generar_formulario",
    description: "Genera el formulario en xlsx o pdf a partir del mapeo. No soporta 'portal'.",
    input_schema: { type: "object", properties: { ...caso, formato: { type: "string", enum: ["xlsx", "pdf"] } }, required: ["caso", "formato"] },
  },
  {
    name: "proveedor_armar_paquete",
    description: "Evalúa la vigencia de soportes, arma checklist.md y borrador-correo.md, y valida el borrador contra datos bancarios.",
    input_schema: { type: "object", properties: { ...caso }, required: ["caso"] },
  },
  {
    name: "proveedor_simular_envio",
    description: "Simula el envío del paquete. Requiere confirmación explícita del usuario en el turno inmediatamente anterior.",
    input_schema: { type: "object", properties: { ...caso }, required: ["caso"] },
  },
];

const IMPLEMENTACIONES: Record<NombreHerramienta, (input: any) => Promise<unknown>> = {
  proveedor_leer_solicitud: proveedorLeerSolicitud,
  proveedor_mapear_campos: proveedorMapearCampos,
  proveedor_generar_formulario: proveedorGenerarFormulario,
  proveedor_armar_paquete: proveedorArmarPaquete,
  proveedor_simular_envio: proveedorSimularEnvio,
};

export const ejecutorReal: Ejecutor = async (nombre, input) => {
  const impl = IMPLEMENTACIONES[nombre as NombreHerramienta];
  if (!impl) throw new ToolError("HERRAMIENTA_DESCONOCIDA", `Herramienta desconocida: ${nombre}`);
  return impl(input);
};
