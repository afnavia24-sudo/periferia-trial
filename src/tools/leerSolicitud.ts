import { cargarSolicitud } from "../lib/repositorio";

export async function proveedorLeerSolicitud(input: { caso: string }) {
  const s = cargarSolicitud(input.caso);
  return {
    caso: s.caso,
    cliente: s.cliente,
    pais: s.pais,
    formato: s.formato,
    campos: s.campos,
    soportes_exigidos: s.soportes_exigidos,
    contacto_cliente: s.contacto_cliente ?? null,
    observaciones: s.observaciones ?? null,
  };
}
