import type { Config } from "../config"
import type { AdaptadorLLM } from "./adapter"
import { AdaptadorAnthropic } from "./anthropic"

/** Crea el adaptador según LLM_PROVIDER. Agregar un proveedor = un caso más aquí y su archivo. */
export function crearAdaptador(config: Config, entorno: NodeJS.ProcessEnv = process.env): AdaptadorLLM {
  switch (config.LLM_PROVIDER) {
    case "anthropic": {
      const apiKey = entorno.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el entorno del backend")
      return new AdaptadorAnthropic({ apiKey, modelo: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS, maxTokensRespuesta: config.LLM_MAX_TOKENS_RESPUESTA })
    }
  }
}
