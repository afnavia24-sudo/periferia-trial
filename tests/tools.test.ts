import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_DIR } from "../src/config";
import { ejecutorReal } from "../src/tools";

const run = (n: string, i: Record<string, unknown>) => ejecutorReal(n, i) as Promise<any>;
async function flujo(caso: string) {
  const s = await run("proveedor_leer_solicitud", { caso });
  const m = await run("proveedor_mapear_campos", { caso });
  const g = s.formato === "portal" ? null : await run("proveedor_generar_formulario", { caso, formato: s.formato });
  const p = await run("proveedor_armar_paquete", { caso });
  return { s, m, g, p };
}

beforeAll(() => fs.rmSync(OUT_DIR, { recursive: true, force: true }));

describe("proveedor_leer_solicitud", () => {
  it("rechaza identificadores con path traversal", async () => {
    await expect(run("proveedor_leer_solicitud", { caso: "../../etc" })).rejects.toMatchObject({ codigo: "CASO_INVALIDO" });
  });
  it("reporta caso inexistente", async () => {
    await expect(run("proveedor_leer_solicitud", { caso: "xx-no-existe" })).rejects.toMatchObject({ codigo: "CASO_NO_ENCONTRADO" });
  });
});

describe("RN1 identificador tributario", () => {
  it("CO no requiere confirmación", async () => {
    const m = await run("proveedor_mapear_campos", { caso: "co-industrias-sur" });
    expect(m.requiere_confirmacion).toEqual([]);
    expect(m.etiqueta_identificador).toBe("NIT");
  });
  it.each([
    ["ec-corp-andina", "RUC"],
    ["pe-retail-sol", "RUC"],
    ["pa-naviera-colon", "RUC"],
    ["hn-cafe-copan", "RTN"],
  ])("%s marca el NIT asignado a campo de %s", async (caso, etiqueta) => {
    const m = await run("proveedor_mapear_campos", { caso });
    expect(m.requiere_confirmacion).toContainEqual(
      expect.objectContaining({ observacion: `Identificador extranjero (NIT colombiano asignado a campo de ${etiqueta})` }),
    );
  });
});

describe("mapeo: faltantes y datos bancarios", () => {
  it("marca faltante por glosario y por maestro", async () => {
    const hn = await run("proveedor_mapear_campos", { caso: "hn-cafe-copan" });
    expect(hn.faltantes).toContainEqual({ campo: "Fax", motivo: "sin equivalente en el glosario" });
    const ec = await run("proveedor_mapear_campos", { caso: "ec-corp-andina" });
    expect(ec.faltantes).toContainEqual({ campo: "Código CIIU", motivo: "sin valor en el repositorio maestro" });
  });
  it("enmascara valores bancarios hacia el modelo pero no en disco", async () => {
    const m = await run("proveedor_mapear_campos", { caso: "pe-retail-sol" });
    const cuenta = m.llenos.find((f: any) => f.canonico === "numero_cuenta");
    expect(cuenta.valor).toBe("****5678");
    const disco = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "pe-retail-sol", "mapeo.json"), "utf8"));
    expect(disco.filas.find((f: any) => f.canonico === "numero_cuenta").valor).toBe("000-123456-78");
  });
});

describe("generación de formularios", () => {
  it("xlsx contiene los valores mapeados", async () => {
    const { g } = await flujo("co-industrias-sur");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.resolve(g.ruta_formulario));
    const valores = wb.getWorksheet("Registro proveedor")!.getColumn(2).values.map(String);
    expect(valores).toContain("900123456-7");
  });
  it("pdf es un PDF válido", async () => {
    const { g } = await flujo("pe-retail-sol");
    expect(fs.readFileSync(path.resolve(g.ruta_formulario)).subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("portal no se genera", async () => {
    await expect(run("proveedor_generar_formulario", { caso: "pa-naviera-colon", formato: "portal" })).rejects.toMatchObject({ codigo: "FORMATO_NO_SOPORTADO" });
  });
  it("rechaza un formato distinto al de la solicitud", async () => {
    await expect(run("proveedor_generar_formulario", { caso: "co-industrias-sur", formato: "pdf" })).rejects.toMatchObject({ codigo: "FORMATO_NO_COINCIDE" });
  });
});

describe("paquete y envío simulado", () => {
  it("caso feliz: listo, borrador sin bancarios, envío simulado", async () => {
    const { p } = await flujo("co-industrias-sur");
    expect(p.listo_para_firma).toBe(true);
    expect(p.apto_para_envio).toBe(true);
    expect(p.fecha_evaluacion).toBe("2026-10-01");
    expect(fs.existsSync(path.resolve(p.ruta_checklist))).toBe(true);
    const e = await run("proveedor_simular_envio", { caso: "co-industrias-sur" });
    expect(e.estado_envio).toBe("simulado_ok");
  });
  it("datos bancarios pedidos: van al formulario, nunca al borrador", async () => {
    const { p } = await flujo("pe-retail-sol");
    expect(p.validacion_borrador.ok).toBe(true);
    expect(p.borrador_correo).not.toContain("123456");
    expect(fs.readFileSync(path.resolve(p.ruta_borrador), "utf8")).not.toContain("123456");
  });
  it("soporte vencido bloquea firma y envío", async () => {
    const { p } = await flujo("pe-logistica-lima");
    expect(p.listo_para_firma).toBe(false);
    expect(p.soportes).toContainEqual(expect.objectContaining({ nombre: "certificacion_bancaria", estado: "vencido" }));
    await expect(run("proveedor_simular_envio", { caso: "pe-logistica-lima" })).rejects.toMatchObject({ codigo: "ENVIO_BLOQUEADO" });
  });
  it("soporte ausente bloquea; faltante no bloquea por sí solo", async () => {
    const hn = await flujo("hn-cafe-copan");
    expect(hn.p.soportes).toContainEqual(expect.objectContaining({ nombre: "estados_financieros", estado: "ausente" }));
    expect(hn.p.listo_para_firma).toBe(false);
    const ec = await flujo("ec-corp-andina");
    expect(ec.m.faltantes.length).toBeGreaterThan(0);
    expect(ec.p.listo_para_firma).toBe(true);
  });
  it("portal: arma paquete pero no es apto para envío simulado", async () => {
    const { p } = await flujo("pa-naviera-colon");
    expect(p.listo_para_firma).toBe(true);
    expect(p.apto_para_envio).toBe(false);
    expect(p.motivos_bloqueo).toContain("formato portal: la carga es manual");
  });
  it("armar paquete exige mapeo y formulario previos", async () => {
    fs.rmSync(path.join(OUT_DIR, "co-industrias-sur"), { recursive: true, force: true });
    await expect(run("proveedor_armar_paquete", { caso: "co-industrias-sur" })).rejects.toMatchObject({ codigo: "MAPEO_NO_EJECUTADO" });
    await run("proveedor_mapear_campos", { caso: "co-industrias-sur" });
    await expect(run("proveedor_armar_paquete", { caso: "co-industrias-sur" })).rejects.toMatchObject({ codigo: "FORMULARIO_NO_GENERADO" });
  });
});

describe("regresiones del caso 1 (co-industrias-sur)", () => {
  const caso = "co-industrias-sur";

  it("no permite enviar dos veces el mismo paquete", async () => {
    await flujo(caso);
    const primero = await run("proveedor_simular_envio", { caso });
    await expect(run("proveedor_simular_envio", { caso })).rejects.toMatchObject({
      codigo: "ENVIO_DUPLICADO",
      detalle: expect.objectContaining({ id_simulacion: primero.id_simulacion }),
    });
  });

  it("re-armar el paquete habilita un nuevo envío y borra el registro anterior", async () => {
    await flujo(caso);
    await run("proveedor_simular_envio", { caso });
    await run("proveedor_armar_paquete", { caso });
    expect(fs.existsSync(path.join(OUT_DIR, caso, "envio-simulado.json"))).toBe(false);
    await expect(run("proveedor_simular_envio", { caso })).resolves.toMatchObject({ estado_envio: "simulado_ok" });
  });

  it("el correo usa la descripción de los soportes, no el identificador técnico", async () => {
    const { p } = await flujo(caso);
    expect(p.borrador_correo).toContain("- Registro Único Tributario");
    expect(p.borrador_correo).toContain("- Certificado de existencia y representación legal");
    expect(p.borrador_correo).not.toMatch(/Soporte: \w+_\w+|Soporte: rut/);
  });

  it("el formulario toma el proveedor del maestro y la fecha en hora de Bogotá", async () => {
    const { g } = await flujo(caso);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.resolve(g.ruta_formulario));
    const ws = wb.getWorksheet("Registro proveedor")!;
    const fila = (etiqueta: string) => ws.getColumn(1).values.findIndex((v) => v === etiqueta);
    expect(ws.getRow(fila("Proveedor")).getCell(2).value).toBe("Periferia IT Group S.A.S.");
    expect(String(ws.getRow(fila("Generado")).getCell(2).value)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(America\/Bogota\)$/);
  });

  it("el paquete no conserva soportes de ejecuciones anteriores", async () => {
    await flujo(caso);
    const sobrante = path.join(OUT_DIR, caso, "paquete", "soportes", "certificacion_bancaria.pdf");
    fs.writeFileSync(sobrante, "viejo");
    await run("proveedor_armar_paquete", { caso });
    expect(fs.existsSync(sobrante)).toBe(false);
    expect(fs.readdirSync(path.dirname(sobrante)).sort()).toEqual(["camara_comercio.pdf", "rut.pdf"]);
  });
});
