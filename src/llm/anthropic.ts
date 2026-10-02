import Anthropic from "@anthropic-ai/sdk"
import { ErrorLLM, type AdaptadorLLM, type Bloque, type HerramientaLLM, type Mensaje, type OpcionesEnvio, type RespuestaLLM } from "./adapter"

interface OpcionesAnthropic {
  apiKey: string
  modelo: string
  timeoutMs: number
  maxTokensRespuesta: number
}

function aAnthropic(m: Mensaje): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = m.bloques.map((b): Anthropic.ContentBlockParam => {
    if (b.tipo === "texto") return { type: "text", text: b.texto }
    if (b.tipo === "llamada") return { type: "tool_use", id: b.id, name: b.nombre, input: b.args }
    return { type: "tool_result", tool_use_id: b.idLlamada, content: b.contenido, is_error: b.esError }
  })
  return { role: m.rol === "usuario" ? "user" : "assistant", content }
}

function deAnthropic(b: Anthropic.ContentBlock): Bloque | null {
  if (b.type === "text") return { tipo: "texto", texto: b.text }
  if (b.type === "tool_use") {
    const args = typeof b.input === "object" && b.input !== null ? (b.input as Record<string, unknown>) : {}
    return { tipo: "llamada", id: b.id, nombre: b.name, args }
  }
  return null
}

function mensajeClaro(e: unknown, timeoutMs: number): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return `El modelo no respondió en ${Math.round(timeoutMs / 1000)} s. Intenta de nuevo.`
  if (e instanceof Anthropic.AuthenticationError) return "El proveedor rechazó la clave de API. Revisa ANTHROPIC_API_KEY en el servidor."
  if (e instanceof Anthropic.RateLimitError) return "El proveedor está limitando las solicitudes. Espera unos segundos e intenta de nuevo."
  if (e instanceof Anthropic.APIConnectionError) return "No hubo conexión con el proveedor del modelo."
  if (e instanceof Anthropic.APIError) return `El proveedor del modelo devolvió un error (${e.status ?? "sin código"}).`
  return "Error inesperado al llamar al modelo."
}

export class AdaptadorAnthropic implements AdaptadorLLM {
  readonly proveedor = "anthropic"
  readonly modelo: string
  private cliente: Anthropic

  constructor(private opciones: OpcionesAnthropic) {
    this.modelo = opciones.modelo
    this.cliente = new Anthropic({ apiKey: opciones.apiKey, timeout: opciones.timeoutMs, maxRetries: 1 })
  }

  async enviar(mensajes: Mensaje[], herramientas: HerramientaLLM[], { sistema }: OpcionesEnvio): Promise<RespuestaLLM> {
    try {
      const r = await this.cliente.messages.create({
        model: this.modelo,
        max_tokens: this.opciones.maxTokensRespuesta,
        system: sistema,
        messages: mensajes.map(aAnthropic),
        tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: { ...h.parametros, type: "object" } })),
      })
      return {
        bloques: r.content.map(deAnthropic).filter((b): b is Bloque => b !== null),
        fin: r.stop_reason === "tool_use" ? "herramientas" : r.stop_reason === "max_tokens" ? "limite_tokens" : "final",
        uso: { entrada: r.usage.input_tokens, salida: r.usage.output_tokens },
      }
    } catch (e) {
      throw new ErrorLLM(mensajeClaro(e, this.opciones.timeoutMs))
    }
  }
}
