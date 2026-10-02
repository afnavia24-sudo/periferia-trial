import { describe, expect, it } from "vitest";
import { detectarDatosBancarios } from "../src/lib/bancarios";
import { esConfirmacionExplicita, extraerCasoDeConfirmacion } from "../src/lib/confirmacion";
import { enmascarar, normalizar } from "../src/lib/normalizar";
import { cargarGlosario } from "../src/lib/repositorio";
import { evaluarVigencia } from "../src/lib/vigencia";
import { resolverCanonico } from "../src/tools/mapearCampos";

describe("normalización y glosario", () => {
  it("normaliza tildes, mayúsculas y signos", () => {
    expect(normalizar("  Número de  RUC: ")).toBe("numero de ruc");
  });
  it.each([
    ["Razón social", "razon_social"],
    ["Nombre de la empresa", "razon_social"],
    ["NIT", "identificador_tributario"],
    ["RUC", "identificador_tributario"],
    ["RTN", "identificador_tributario"],
    ["Correo electrónico", "correo_contacto"],
    ["Número de cuenta", "numero_cuenta"],
    ["Fax", null],
  ])("resuelve '%s' → %s", (etiqueta, esperado) => {
    expect(resolverCanonico(etiqueta, cargarGlosario())).toBe(esperado);
  });
  it("enmascara dejando los últimos 4 dígitos", () => {
    expect(enmascarar("000-123456-78")).toBe("****5678");
  });
});

describe("RN3 vigencia", () => {
  const f = "2026-10-01";
  it.each([
    [true, "2026-10-01", "vigente"],
    [true, "2026-10-02", "vigente"],
    [true, "2026-09-30", "vencido"],
    [true, null, "vigente"],
    [false, "2027-01-01", "ausente"],
  ] as const)("existe=%s vigencia=%s → %s", (existe, vigenciaHasta, esperado) => {
    expect(evaluarVigencia({ existe, vigenciaHasta, fechaEvaluacion: f })).toBe(esperado);
  });
});

describe("RN2 detección de datos bancarios", () => {
  it("detecta un número de cuenta del maestro", () => {
    expect(detectarDatosBancarios("Pagar a 000-123456-78", ["000-123456-78"]).encontrado).toBe(true);
  });
  it("detecta palabra clave + número", () => {
    expect(detectarDatosBancarios("nuestra cuenta de ahorros en Bancolombia es 123-456789-00").encontrado).toBe(true);
  });
  it("detecta IBAN", () => {
    expect(detectarDatosBancarios("IBAN ES9121000418450200051332").encontrado).toBe(true);
  });
  it("no marca la mención de un campo pendiente", () => {
    expect(detectarDatosBancarios("Queda pendiente: - Número de cuenta - Tipo de cuenta").encontrado).toBe(false);
  });
  it("no marca un NIT ni un teléfono", () => {
    expect(detectarDatosBancarios("NIT 900123456-7, teléfono +57 601 000 0000").encontrado).toBe(false);
  });
});

describe("RN4 confirmación explícita", () => {
  it.each(["Sí, autorizo el envío", "Procede a enviar", "Confirmo, envía el paquete", "si envia", "Autorizo el envío del caso"])(
    "válida: %s",
    (m) => expect(esConfirmacionExplicita(m).valida).toBe(true),
  );
  it.each([
    "ok", "dale", "listo", "suena bien", "👍", "Perfecto, gracias", "Procede",
    "Sí, envía, pero cambia el correo de contacto",
    "¿Autorizo el envío?",
    "No autorizo el envío",
    "Antes de enviar revisa el RUT, luego autorizo el envío",
  ])("inválida: %s", (m) => expect(esConfirmacionExplicita(m).valida).toBe(false));

  it("extrae el caso de la pregunta de confirmación", () => {
    expect(extraerCasoDeConfirmacion("💡 **¿Autorizas la simulación del envío del paquete del caso co-industrias-sur al cliente?**")).toBe("co-industrias-sur");
    expect(extraerCasoDeConfirmacion("¿Deseas algo más?")).toBeNull();
  });
});
