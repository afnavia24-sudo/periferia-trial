import fs from "node:fs"
import path from "node:path"
import { ErrorNegocio, type Ctx } from "./contrato"

const CASO_VALIDO = /^[a-z0-9][a-z0-9-]{0,80}$/

export function validarCaso(caso: string): string {
  if (!CASO_VALIDO.test(caso)) throw new ErrorNegocio(`identificador de caso inválido: "${caso}"`)
  return caso
}

export function rutas(ctx: Ctx) {
  const fixtures = path.join(ctx.directory, "fixtures", "reto-01")
  // OUT_DIR permite escribir fuera del proyecto (en Vercel solo /tmp admite escritura).
  const out = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(ctx.directory, "out")
  return {
    fixtures,
    casos: path.join(fixtures, "casos"),
    maestro: path.join(fixtures, "repositorio", "maestro.json"),
    glosario: path.join(fixtures, "glosario-campos.json"),
    soportes: path.join(fixtures, "repositorio", "soportes"),
    out,
    logGlobal: path.join(out, "log.jsonl"),
  }
}

export function dirCaso(ctx: Ctx, caso: string): string {
  return path.join(rutas(ctx).casos, validarCaso(caso))
}

export function dirSalida(ctx: Ctx, caso: string): string {
  const dir = path.join(rutas(ctx).out, validarCaso(caso))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Ruta relativa a la raíz del proyecto, para reportar sin exponer rutas absolutas. Las salidas siempre se reportan como out/... */
export function relativa(ctx: Ctx, ruta: string): string {
  const { out } = rutas(ctx)
  const dentroDeOut = ruta === out || ruta.startsWith(out + path.sep)
  return (dentroDeOut ? path.join("out", path.relative(out, ruta)) : path.relative(ctx.directory, ruta)).split(path.sep).join("/")
}
