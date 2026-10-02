/**
 * Genera modulo/ (bonus §9.4) desde las mismas fuentes que usa la aplicación:
 *   agent/prompt.md                       → modulo/agent.md (frontmatter + prompt)
 *   src/knowledge/registro-proveedor.md   → modulo/skill/registro-proveedor/SKILL.md
 *   src/tools/proveedor.ts                → modulo/tools/proveedor.ts (re-export, sin copia)
 * tests/modulo.test.ts falla si modulo/ diverge de las fuentes.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function contenidosModulo(raiz = RAIZ): Record<string, string> {
  const prompt = fs.readFileSync(path.join(raiz, "agent", "prompt.md"), "utf8")
  const conocimiento = fs.readFileSync(path.join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8")
  return {
    "modulo/agent.md": [
      "---",
      "description: Prepara el registro de Periferia IT Group como proveedor ante clientes (CO, EC, PE, PA, HN). Lee la solicitud, llena el formulario desde el repositorio maestro, arma el paquete para firma y nunca envía sin confirmación explícita.",
      "mode: primary",
      "permission:",
      "  edit: deny",
      "  bash: deny",
      "---",
      "",
      prompt,
    ].join("\n"),
    "modulo/skill/registro-proveedor/SKILL.md": [
      "---",
      "name: registro-proveedor",
      "description: Conocimiento del proceso de registro como proveedor de Periferia IT Group. Úsalo al llenar formularios de proveedor, traducir el identificador tributario por país, evaluar vigencia de soportes o preparar el paquete para firma.",
      "---",
      "",
      conocimiento,
    ].join("\n"),
    "modulo/tools/proveedor.ts": [
      "// Las mismas herramientas que usa la aplicación, importables sin el servidor HTTP.",
      "// Cada export se expone al modelo como proveedor_<export>. Generado por scripts/build-modulo.ts.",
      'export * from "../../src/tools/proveedor"',
      "",
    ].join("\n"),
  }
}

const esPrincipal = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esPrincipal) {
  for (const [archivo, contenido] of Object.entries(contenidosModulo())) {
    const destino = path.join(RAIZ, archivo)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, contenido)
    console.log(`✔ ${archivo}`)
  }
}
