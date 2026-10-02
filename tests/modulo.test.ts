import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import * as delModulo from "../modulo/tools/proveedor"
import * as deLaApp from "../src/tools/proveedor"
import { RAIZ, contenidosModulo } from "../scripts/build-modulo"

describe("modulo/ (bonus §9.4)", () => {
  it("agent.md y SKILL.md son las mismas piezas que usa la app (si falla: npm run build:modulo)", () => {
    for (const [archivo, esperado] of Object.entries(contenidosModulo())) {
      expect(fs.readFileSync(path.join(RAIZ, archivo), "utf8"), archivo).toBe(esperado)
    }
  })
  it("las herramientas del módulo son exactamente las de la aplicación", () => {
    expect(Object.keys(delModulo).sort()).toEqual(Object.keys(deLaApp).sort())
    expect(delModulo.leer_solicitud).toBe(deLaApp.leer_solicitud)
  })
  it("agent.md declara modo primario y niega edit y bash", () => {
    const md = fs.readFileSync(path.join(RAIZ, "modulo/agent.md"), "utf8")
    expect(md).toMatch(/^---\ndescription: .+\nmode: primary\npermission:\n {2}edit: deny\n {2}bash: deny\n---/)
  })
})
