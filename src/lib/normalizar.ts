/** Minúsculas, sin tildes, sin signos de puntuación, espacios colapsados. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function enmascarar(valor: string): string {
  const visibles = valor.replace(/\D/g, "").slice(-4);
  return visibles ? `****${visibles}` : "****";
}
