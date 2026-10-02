import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { AgenteProveedor } from "./agent/agente";
import { MODELO } from "./config";
import { ejecutorReal } from "./tools";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY en el entorno.");
  process.exit(1);
}

const agente = new AgenteProveedor({ cliente: new Anthropic(), ejecutor: ejecutorReal });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Perixia 2.0 - registro como proveedor (modelo: ${MODELO}). Escribe "salir" para terminar.\n`);

while (true) {
  const msg = (await rl.question("👤 ")).trim();
  if (!msg) continue;
  if (["salir", "exit"].includes(msg.toLowerCase())) break;
  try {
    const r = await agente.enviar(msg);
    for (const l of r.llamadas) {
      const marca = l.bloqueada ? "🛑" : l.error ? "⚠️" : "🔧";
      console.log(`${marca} ${l.nombre}(${JSON.stringify(l.input)})${l.error ? ` → ${l.error.error}` : ""}`);
    }
    console.log(`\n🤖 ${r.texto}\n`);
  } catch (e) {
    console.error("Error del agente:", (e as Error).message);
  }
}
rl.close();
