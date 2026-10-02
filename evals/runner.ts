/**
 * Runner de evals del agente. Usa el modelo real con herramientas simuladas (mocks del YAML)
 * y el mismo orquestador de producción, así que mide el prompt y las guardias juntos.
 *
 *   npm run evals                         # todos los casos
 *   npm run evals -- --filtro EV-1        # casos cuyo id empieza por EV-1
 *   npm run evals -- --juez               # activa LLM-as-judge para los criterios "juez"
 *   npm run evals -- --repeticiones 3     # mide estabilidad (flakiness)
 *   npm run evals -- --dry                # solo valida y expande el YAML (sin API)
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import YAML from "yaml";
import { AgenteProveedor, type ClienteLLM, type RespuestaTurno } from "../src/agent/agente";
import { MODELO } from "../src/config";
import { ToolError } from "../src/lib/errores";
import type { Ejecutor } from "../src/tools";

interface Esperado {
  herramientas_llamadas?: string[];
  herramientas_prohibidas?: string[];
  debe_contener?: string[];
  no_debe_contener?: string[];
  no_debe_contener_regex?: string[];
  max_llamadas_por_herramienta?: Record<string, number>;
  orden_casos?: string[];
  juez?: string;
}
interface CasoEval {
  id: string;
  categoria: string;
  reglas?: string[];
  descripcion: string;
  input: string;
  conversacion?: { rol: "usuario" | "agente"; texto: string }[];
  estado_inicial?: { aptos?: string[] };
  mocks?: Record<string, any> | string;
  mocks_de?: string[];
  parametros?: Record<string, string>[];
  esperado: Esperado;
}
interface Verificacion { regla: string; ok: boolean; detalle: string }
interface ResultadoEval {
  id: string;
  categoria: string;
  descripcion: string;
  ok: boolean;
  tasa_exito: string;
  verificaciones: Verificacion[];
  respuesta?: string;
  llamadas?: { nombre: string; input: unknown; bloqueada: boolean; error?: string }[];
  error?: string;
}

// ------------------------------------------------------------------ args
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const valor = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const FILTRO = valor("filtro");
const REPETICIONES = Math.max(1, Number(valor("repeticiones") ?? 1));
const USAR_JUEZ = flag("juez");
const DRY = flag("dry");
const MODELO_EVAL = valor("modelo") ?? MODELO;
const DIR_REPORTES = path.resolve(valor("salida") ?? "reports");

// ------------------------------------------------------------------ carga y expansión
const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const casoDeInput = (input: string) => input.match(/'([a-z0-9][a-z0-9-]+)'/)?.[1] ?? null;

function sustituir<T>(obj: T, params: Record<string, string>): T {
  let s = JSON.stringify(obj);
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(v);
  return JSON.parse(s);
}

export function cargarCasos(ruta = path.resolve("evals/casos.yaml")): CasoEval[] {
  const doc = YAML.parse(fs.readFileSync(ruta, "utf8")) as { casos: CasoEval[] };
  const expandidos: CasoEval[] = [];
  for (const c of doc.casos) {
    if (!c.id || !c.input || !c.esperado) throw new Error(`Eval inválido: ${JSON.stringify(c).slice(0, 80)}`);
    if (!c.parametros) { expandidos.push(c); continue; }
    c.parametros.forEach((p, i) => {
      const { parametros: _omit, ...base } = c;
      const e = sustituir(base, p);
      expandidos.push({ ...e, id: `${c.id}.${i + 1}`, descripcion: `${e.descripcion} [${Object.values(p).join(", ")}]` });
    });
  }
  return expandidos;
}

function construirEjecutor(c: CasoEval, todos: CasoEval[]): Ejecutor {
  const global = typeof c.mocks === "object" && c.mocks ? c.mocks : {};
  const porCaso: Record<string, Record<string, any>> = {};
  for (const ref of c.mocks_de ?? []) {
    const otro = todos.find((t) => t.id === ref);
    const id = otro && casoDeInput(otro.input);
    if (!otro || !id || typeof otro.mocks !== "object") throw new Error(`${c.id}: mocks_de inválido (${ref})`);
    porCaso[id] = otro.mocks;
  }
  return async (nombre, input) => {
    const caso = String(input.caso ?? "");
    const mock = porCaso[caso]?.[nombre] ?? (global as Record<string, any>)[nombre];
    if (mock === undefined) throw new ToolError("MOCK_NO_DEFINIDO", `No hay mock para ${nombre} (caso ${caso})`);
    if (mock && typeof mock === "object" && "error" in mock) throw new ToolError(mock.error, mock.mensaje ?? mock.error);
    return structuredClone(mock);
  };
}

// ------------------------------------------------------------------ verificaciones
function verificar(c: CasoEval, r: RespuestaTurno): Verificacion[] {
  const e = c.esperado;
  const v: Verificacion[] = [];
  const intentadas = r.llamadas.map((l) => l.nombre);
  const texto = norm(r.texto);

  if (e.herramientas_llamadas) {
    const ok = JSON.stringify(intentadas) === JSON.stringify(e.herramientas_llamadas);
    v.push({ regla: "herramientas_llamadas", ok, detalle: ok ? "secuencia correcta" : `esperado ${e.herramientas_llamadas.join(" → ")} | obtenido ${intentadas.join(" → ") || "(ninguna)"}` });
  }
  for (const h of e.herramientas_prohibidas ?? []) {
    const intentos = r.llamadas.filter((l) => l.nombre === h);
    const ok = intentos.length === 0;
    const bloqueadas = intentos.filter((l) => l.bloqueada).length;
    v.push({ regla: `prohibida:${h}`, ok, detalle: ok ? "no se intentó" : `se intentó ${intentos.length} vez/veces (${bloqueadas} bloqueada(s) por la guardia)` });
  }
  for (const s of e.debe_contener ?? []) {
    const ok = texto.includes(norm(s));
    v.push({ regla: "debe_contener", ok, detalle: `"${s}"` });
  }
  for (const s of e.no_debe_contener ?? []) {
    const ok = !texto.includes(norm(s));
    v.push({ regla: "no_debe_contener", ok, detalle: `"${s}"` });
  }
  for (const rx of e.no_debe_contener_regex ?? []) {
    const ok = !new RegExp(rx, "i").test(texto);
    v.push({ regla: "no_debe_contener_regex", ok, detalle: rx });
  }
  for (const [h, max] of Object.entries(e.max_llamadas_por_herramienta ?? {})) {
    const n = intentadas.filter((x) => x === h).length;
    v.push({ regla: `max_llamadas:${h}`, ok: n <= max, detalle: `${n}/${max}` });
  }
  if (e.orden_casos) {
    const vistos = [...new Set(r.llamadas.filter((l) => l.nombre === "proveedor_leer_solicitud").map((l) => String(l.input.caso)))];
    const ok = vistos.length > 0 && vistos.every((c2, i) => e.orden_casos![i] === c2);
    v.push({ regla: "orden_casos", ok, detalle: `obtenido ${vistos.join(", ") || "(ninguno)"}` });
  }
  return v;
}

async function juzgar(cliente: Anthropic, c: CasoEval, r: RespuestaTurno): Promise<Verificacion> {
  const traza = r.llamadas.map((l) => `${l.nombre}(${JSON.stringify(l.input)})${l.bloqueada ? " [BLOQUEADA]" : ""}${l.error ? ` → ${l.error.error}` : ""}`).join("\n");
  const msg = await cliente.messages.create({
    model: MODELO_EVAL,
    max_tokens: 400,
    system: "Eres un evaluador QA estricto de agentes conversacionales. Evalúas solo el criterio dado, sin suponer información ausente. Responde ÚNICAMENTE con JSON: {\"cumple\": boolean, \"razon\": string}.",
    messages: [{
      role: "user",
      content: `CRITERIO:\n${c.esperado.juez}\n\nMENSAJE DEL USUARIO:\n${c.input}\n\nHERRAMIENTAS LLAMADAS:\n${traza || "(ninguna)"}\n\nRESPUESTA DEL AGENTE:\n${r.texto}`,
    }],
  });
  const crudo = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").replace(/```json|```/g, "").trim();
  try {
    const j = JSON.parse(crudo) as { cumple: boolean; razon: string };
    return { regla: "juez", ok: Boolean(j.cumple), detalle: j.razon };
  } catch {
    return { regla: "juez", ok: false, detalle: `respuesta del juez no parseable: ${crudo.slice(0, 120)}` };
  }
}

// ------------------------------------------------------------------ reportes
const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);

function escribirReportes(resultados: ResultadoEval[]) {
  fs.mkdirSync(DIR_REPORTES, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const json = path.join(DIR_REPORTES, `evals-${sello}.json`);
  fs.writeFileSync(json, JSON.stringify({ modelo: MODELO_EVAL, repeticiones: REPETICIONES, juez: USAR_JUEZ, resultados }, null, 2));
  const fallos = resultados.filter((r) => !r.ok).length;
  const casos = resultados.map((r) => {
    const cuerpo = r.ok ? "" : `<failure message="${xml(r.error ?? r.verificaciones.filter((v) => !v.ok).map((v) => `${v.regla}: ${v.detalle}`).join(" | "))}"/>`;
    return `  <testcase classname="${xml(r.categoria)}" name="${xml(`${r.id} ${r.descripcion}`)}">${cuerpo}</testcase>`;
  });
  const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="perixia-proveedor-evals" tests="${resultados.length}" failures="${fallos}">\n${casos.join("\n")}\n</testsuite>\n`;
  fs.writeFileSync(path.join(DIR_REPORTES, "junit-evals.xml"), junit);
  return json;
}

// ------------------------------------------------------------------ main
async function main() {
  const todos = cargarCasos();
  const casos = todos.filter((c) => !FILTRO || c.id.startsWith(FILTRO));
  for (const c of casos) construirEjecutor(c, todos); // valida mocks_de

  if (DRY) {
    console.log(`✔ YAML válido: ${casos.length} evals tras expandir parámetros.`);
    for (const c of casos) console.log(`  ${c.id.padEnd(8)} [${c.categoria}] ${c.descripcion}`);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY. Usa --dry para validar el YAML sin llamar a la API.");
    process.exit(2);
  }

  const cliente = new Anthropic();
  const resultados: ResultadoEval[] = [];
  console.log(`Modelo: ${MODELO_EVAL} | evals: ${casos.length} | repeticiones: ${REPETICIONES} | juez: ${USAR_JUEZ ? "sí" : "no"}\n`);

  for (const c of casos) {
    let exitos = 0;
    let ultimo: ResultadoEval | null = null;
    for (let rep = 0; rep < REPETICIONES; rep++) {
      try {
        const agente = new AgenteProveedor({ cliente: cliente as ClienteLLM, ejecutor: construirEjecutor(c, todos), modelo: MODELO_EVAL });
        agente.sembrar(c.conversacion ?? [], c.estado_inicial);
        const r = await agente.enviar(c.input);
        const verificaciones = verificar(c, r);
        if (c.esperado.juez) {
          verificaciones.push(USAR_JUEZ ? await juzgar(cliente, c, r) : { regla: "juez", ok: true, detalle: "omitido (usa --juez)" });
        }
        const ok = verificaciones.every((v) => v.ok);
        if (ok) exitos++;
        if (!ok || !ultimo) {
          ultimo = {
            id: c.id, categoria: c.categoria, descripcion: c.descripcion, ok, tasa_exito: "", verificaciones, respuesta: r.texto,
            llamadas: r.llamadas.map((l) => ({ nombre: l.nombre, input: l.input, bloqueada: l.bloqueada, error: l.error?.error })),
          };
        }
      } catch (e) {
        ultimo = { id: c.id, categoria: c.categoria, descripcion: c.descripcion, ok: false, tasa_exito: "", verificaciones: [], error: (e as Error).message };
      }
    }
    const res = { ...ultimo!, ok: exitos === REPETICIONES, tasa_exito: `${exitos}/${REPETICIONES}` };
    resultados.push(res);
    console.log(`${res.ok ? "✅" : "❌"} ${c.id.padEnd(8)} ${res.tasa_exito.padEnd(5)} ${c.descripcion}`);
    if (!res.ok) {
      if (res.error) console.log(`     error: ${res.error}`);
      for (const v of res.verificaciones.filter((x) => !x.ok)) console.log(`     ✗ ${v.regla}: ${v.detalle}`);
    }
  }

  const fallos = resultados.filter((r) => !r.ok).length;
  const ruta = escribirReportes(resultados);
  console.log(`\n${resultados.length - fallos}/${resultados.length} evals OK. Reporte: ${path.relative(process.cwd(), ruta)}`);
  process.exit(fallos ? 1 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
