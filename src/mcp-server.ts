/**
 * Servidor MCP (stdio) con las cinco herramientas, para usarlas desde Claude Desktop / Claude Code u otro host MCP.
 *
 * Limitación: en modo MCP el host controla la conversación, así que la guardia conversacional de RN4
 * (turno inmediatamente anterior) no puede aplicarse aquí. Como mitigación, proveedor_simular_envio exige
 * el texto literal de la confirmación del usuario y lo valida, además de la guardia de "apto para envío".
 * Para la garantía completa usa el orquestador (src/agent/agente.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { esConfirmacionExplicita } from "./lib/confirmacion";
import { ToolError } from "./lib/errores";
import { DEFINICIONES, ejecutorReal } from "./tools";

const servidor = new McpServer({ name: "perixia-proveedor", version: "2.0.0" });
const descripcion = (n: string) => DEFINICIONES.find((d) => d.name === n)?.description ?? n;

async function ejecutar(nombre: string, input: Record<string, unknown>) {
  try {
    const r = await ejecutorReal(nombre, input);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  } catch (e) {
    const err = e instanceof ToolError ? e.toJSON() : { error: "ERROR_INTERNO", mensaje: (e as Error).message };
    return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
  }
}

const caso = z.string().describe("Identificador del caso, p. ej. 'ec-corp-andina'");

servidor.registerTool("proveedor_leer_solicitud", { description: descripcion("proveedor_leer_solicitud"), inputSchema: { caso } },
  (a) => ejecutar("proveedor_leer_solicitud", a));
servidor.registerTool("proveedor_mapear_campos", { description: descripcion("proveedor_mapear_campos"), inputSchema: { caso, campos: z.array(z.string()).optional() } },
  (a) => ejecutar("proveedor_mapear_campos", a));
servidor.registerTool("proveedor_generar_formulario", { description: descripcion("proveedor_generar_formulario"), inputSchema: { caso, formato: z.enum(["xlsx", "pdf"]) } },
  (a) => ejecutar("proveedor_generar_formulario", a));
servidor.registerTool("proveedor_armar_paquete", { description: descripcion("proveedor_armar_paquete"), inputSchema: { caso } },
  (a) => ejecutar("proveedor_armar_paquete", a));
servidor.registerTool(
  "proveedor_simular_envio",
  {
    description: `${descripcion("proveedor_simular_envio")} Pasa en confirmacion_usuario el texto literal con el que el usuario autorizó.`,
    inputSchema: { caso, confirmacion_usuario: z.string().describe("Texto literal de la confirmación del usuario") },
  },
  async ({ caso: c, confirmacion_usuario }) => {
    const v = esConfirmacionExplicita(confirmacion_usuario);
    if (!v.valida) {
      const err = new ToolError("BLOQUEADO_POR_POLITICA", `Confirmación no válida: ${v.motivo}`).toJSON();
      return { content: [{ type: "text" as const, text: JSON.stringify(err) }], isError: true };
    }
    return ejecutar("proveedor_simular_envio", { caso: c });
  },
);

await servidor.connect(new StdioServerTransport());
