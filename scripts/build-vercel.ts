/**
 * Genera .vercel/output (Build Output API v3) para desplegar en Vercel:
 *   static/              el front (web/), servido por la CDN
 *   functions/api.func/  una función Node con el backend empaquetado, sus dependencias de producción
 *                        y los archivos que se leen con fs (prompt, conocimiento y fixtures)
 * Así no dependemos de que Vercel adivine qué archivos incluir ni de cómo resuelve los imports de TS.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { build } from "esbuild"

const RAIZ = path.resolve(import.meta.dirname, "..")
const SALIDA = path.join(RAIZ, ".vercel", "output")
const FUNCION = path.join(SALIDA, "functions", "api.func")
/** Leídos con fs en tiempo de ejecución; la función los busca relativos a su raíz. */
const DATOS = ["agent", "fixtures", "src/knowledge"]

const copiar = (origen: string, destino: string) => fs.cpSync(path.join(RAIZ, origen), destino, { recursive: true })
const escribirJson = (ruta: string, datos: unknown) => fs.writeFileSync(ruta, JSON.stringify(datos, null, 2) + "\n")

fs.rmSync(SALIDA, { recursive: true, force: true })
fs.mkdirSync(FUNCION, { recursive: true })

// 1. Backend en un solo archivo. Queda en src/ para que la raíz que calcula server.ts sea la de la función.
await build({
  entryPoints: [path.join(RAIZ, "src", "vercel.ts")],
  outfile: path.join(FUNCION, "src", "vercel.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external", // exceljs y pdfkit leen archivos de su propio paquete: van completos en node_modules
  logLevel: "warning",
})

// 2. Dependencias de producción, instaladas desde el lockfile para la plataforma de Vercel.
for (const f of ["package.json", "package-lock.json"]) copiar(f, path.join(FUNCION, f))
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: FUNCION, stdio: "inherit" })

// 3. Archivos que el backend lee con fs.
for (const d of DATOS) copiar(d, path.join(FUNCION, d))

escribirJson(path.join(FUNCION, ".vc-config.json"), {
  runtime: "nodejs22.x",
  handler: "src/vercel.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false, // el backend lee el cuerpo él mismo
  maxDuration: 300, // un turno puede encadenar varias llamadas al modelo
  environment: { OUT_DIR: "/tmp/out" }, // único directorio con escritura en Vercel
})

// 4. Front estático.
copiar("web", path.join(SALIDA, "static"))

// 5. Rutas: primero los estáticos; todo /api/* va a la función, que enruta por req.url.
escribirJson(path.join(SALIDA, "config.json"), {
  version: 3,
  routes: [{ handle: "filesystem" }, { src: "^/api(?:/.*)?$", dest: "/api" }],
})

console.log(`✔ ${path.relative(RAIZ, SALIDA)} listo`)
