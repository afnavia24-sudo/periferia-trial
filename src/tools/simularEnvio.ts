import path from "node:path";
import { ToolError } from "../lib/errores";
import { dirCaso, guardarJson, leerJsonSiExiste, rel } from "../lib/repositorio";
import type { EstadoPaquete } from "./armarPaquete";

/**
 * Simulación: NO envía nada. Deja constancia en out/<caso>/envio-simulado.json.
 * Idempotencia: un paquete solo se envía una vez. Para volver a enviar hay que re-armarlo.
 */
export async function proveedorSimularEnvio(input: { caso: string }) {
  const rutaEstado = path.join(dirCaso(input.caso), "estado.json");
  const estado = leerJsonSiExiste<EstadoPaquete>(rutaEstado);
  if (!estado) throw new ToolError("PAQUETE_NO_ARMADO", `No hay paquete armado para ${input.caso}`);
  if (estado.envio) {
    throw new ToolError("ENVIO_DUPLICADO", `El paquete de ${input.caso} ya se envió (${estado.envio.id_simulacion}). Para reenviar, vuelve a armar el paquete.`, estado.envio);
  }
  if (!estado.apto_para_envio) {
    throw new ToolError("ENVIO_BLOQUEADO", `El paquete de ${input.caso} no es apto para envío`, { motivos: estado.motivos_bloqueo });
  }
  const id = `SIM-${Date.now().toString(36).toUpperCase()}`;
  const simulado_en = new Date().toISOString();
  const registro = {
    id_simulacion: id,
    caso: input.caso,
    estado_envio: "simulado_ok",
    destinatario: estado.destinatario,
    simulado_en,
    nota: "Envío simulado. No se envió ningún correo ni se cargó información en portales.",
  };
  const ruta = path.join(dirCaso(input.caso), "envio-simulado.json");
  guardarJson(ruta, registro);
  guardarJson(rutaEstado, { ...estado, envio: { id_simulacion: id, simulado_en } });
  return { ...registro, registro: rel(ruta) };
}
