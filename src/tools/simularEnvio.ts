import path from "node:path";
import { ToolError } from "../lib/errores";
import { dirCaso, guardarJson, leerJsonSiExiste, rel } from "../lib/repositorio";
import type { EstadoPaquete } from "./armarPaquete";

/** Simulación: NO envía nada. Deja constancia en out/<caso>/envio-simulado.json. */
export async function proveedorSimularEnvio(input: { caso: string }) {
  const estado = leerJsonSiExiste<EstadoPaquete>(path.join(dirCaso(input.caso), "estado.json"));
  if (!estado) throw new ToolError("PAQUETE_NO_ARMADO", `No hay paquete armado para ${input.caso}`);
  if (!estado.apto_para_envio) {
    throw new ToolError("ENVIO_BLOQUEADO", `El paquete de ${input.caso} no es apto para envío`, { motivos: estado.motivos_bloqueo });
  }
  const id = `SIM-${Date.now().toString(36).toUpperCase()}`;
  const registro = {
    id_simulacion: id,
    caso: input.caso,
    estado_envio: "simulado_ok",
    destinatario: estado.destinatario,
    simulado_en: new Date().toISOString(),
    nota: "Envío simulado. No se envió ningún correo ni se cargó información en portales.",
  };
  const ruta = path.join(dirCaso(input.caso), "envio-simulado.json");
  guardarJson(ruta, registro);
  return { ...registro, registro: rel(ruta) };
}
