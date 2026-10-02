# Reto 01 · Agente "Registro como Proveedor"

Agente conversacional que lee una solicitud de registro como proveedor, llena el formulario del cliente desde el repositorio maestro de Periferia, arma el paquete para la firma del representante legal y **nunca envía nada sin confirmación explícita**.

- **Link de prueba:** `<pega aquí la URL de Vercel o Render>`
- **Clave de acceso del link:** `<pega aquí el valor de ACCESS_KEY>` (el front la pide al entrar)

## Arranque en local (un comando)

Requisitos: Node 22.9+ (los scripts `dev` y `start` usan `--env-file-if-exists`) o Bun 1.1+.

```bash
cp .env.example .env        # y escribe tu ANTHROPIC_API_KEY
npm install && npm run dev  # o: bun install && bun run dev
```

Abre http://localhost:3000. `npm run dev` recarga al guardar cambios; `npm start` arranca sin recarga. Ambos leen `.env` si existe (está en `.gitignore`: la clave no se sube).

## Verificación sin modelo

```bash
npm run demo                # o: bun run demo.ts
```

Ejecuta los 4 casos de `fixtures/reto-01/casos/` llamando directamente a las herramientas, sin clave de ningún proveedor. Limpia `out/` al inicio y produce el mismo resultado en ejecuciones consecutivas (salvo timestamps).

```bash
npm test                    # 73 tests: herramientas, ciclo del agente, sesiones, API, demo y módulo
npm run typecheck
```

## Variables de entorno

| Variable | Obligatoria | Default | Uso |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (para el chat) | — | Clave del modelo. Solo vive en el backend; nunca llega al front, a los logs ni a las respuestas. |
| `LLM_PROVIDER` | No | `anthropic` | Implementación del adaptador LLM |
| `LLM_MODEL` | No | `claude-sonnet-5-5` | Modelo |
| `LLM_TIMEOUT_MS` | No | `60000` | Timeout por llamada al proveedor |
| `LLM_MAX_TOKENS_RESPUESTA` | No | `4096` | Tope de tokens por respuesta del modelo |
| `MAX_ITERACIONES` | No | `25` | Tope de ciclos herramienta → modelo por turno (CA1) |
| `MAX_TOKENS_SESION` | No | `300000` | Tope de tokens por sesión |
| `MAX_TOKENS_GLOBAL` | No | `5000000` | Tope de tokens del proceso (protege la clave de un uso sin límite) |
| `ACCESS_KEY` | No | — | Si se define, la API exige el header `x-access-key` |
| `FECHA_EJECUCION` | No | hoy en America/Bogota | Fija la fecha con la que se evalúan las vigencias (`YYYY-MM-DD`) |
| `PORT` | No | `3000` | Puerto HTTP |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | En Vercel, sí | — | Upstash Redis para las sesiones (los crea la integración de Vercel). También se aceptan `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Sin ellos, las sesiones viven en memoria |
| `OUT_DIR` | No | `out/` del proyecto | Carpeta de salidas. En Vercel se fija sola a `/tmp/out` |

Las variables vacías cuentan como no definidas, así que `.env.example` copiado tal cual funciona.

## Prueba sugerida (PRD §11)

En una conversación nueva:

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

Luego escribe `envía`: el agente pide confirmación y el chat la resalta. Con `Sí, confirmo el envío` (o el botón) se escribe solo `out/ec-corp-andina/ENVIO-SIMULADO.md`.

> Con la fecha real, la Cámara de Comercio del repositorio venció el 2026-09-30, así que ningún caso queda listo para firma. Para ver un caso listo: `FECHA_EJECUCION=2026-09-15 npm run demo`.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, error }` |
| `GET` | `/api/sessions/:id` | `{ id, creada, tokensUsados, needsConfirmation, historial[] }` |
| `GET` | `/api/health` | `{ ok, provider, model, requiresAccessKey, sessionStore, casos[] }` (sin claves). `sessionStore` es `memoria` o `redis` |

`toolCalls[]` trae, por cada llamada, `{ nombre, args, ok, resumen, bloqueada }`. Si no se envía `sessionId`, se crea una sesión nueva. Errores: `400` (cuerpo inválido), `401` (clave de acceso), `409` (la sesión está procesando otro mensaje).

## Estructura

```
agent/prompt.md                  comportamiento del agente (system prompt)
src/knowledge/                   conocimiento del proceso y reglas parametrizables (reglas.json)
src/tools/proveedor.ts           las 5 herramientas (cada export → proveedor_<export>)
src/tools/registro.ts            validación zod, ejecución y logs (RN5, CA4)
src/tools/lib/                   carga de fixtures, mapeo, formularios, paquete
src/agent/                       ciclo del agente, guardia de confirmación, sesiones
src/llm/                         interfaz del proveedor + implementación Anthropic
src/server.ts                    API HTTP y estáticos (servidor local, Render)
src/vercel.ts                    la misma API como función de Vercel
scripts/build-vercel.ts          genera .vercel/output para Vercel
web/                             front de chat (HTML, CSS y JS sin build)
modulo/                          bonus §9.4 (generado con npm run build:modulo)
fixtures/                        entregados por Periferia (solo lectura)
out/                             generado en ejecución
demo.ts                          verificación sin modelo
```

## Salidas por caso

```
out/<caso>/
├── formulario.xlsx | formulario.pdf | valores-portal.md
├── paquete/            formulario, soportes, checklist.md, borrador-correo.md
├── ENVIO-SIMULADO.md   solo tras confirmación explícita
├── log.jsonl           { ts, herramienta, ok, resumen }
├── mapeo.json · estado.json
out/log.jsonl           todas las llamadas, con sessionId
```

## Despliegue en Vercel

`vercel.json` ejecuta `npm run build:vercel`, que genera `.vercel/output`: el front como estático y `/api/*` como una función Node 22 con el backend empaquetado, sus dependencias y los archivos que lee (prompt, conocimiento y fixtures).

1. En Vercel: **Add New → Project** e importa el repo. No cambies el preset ni los comandos: los toma de `vercel.json`.
2. En **Settings → Environment Variables**, carga `ANTHROPIC_API_KEY` y `ACCESS_KEY`.
3. En **Storage** (o el Marketplace), crea una base **Upstash Redis** y conéctala al proyecto. Esto agrega `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
4. Vuelve a desplegar (**Deployments → Redeploy**) para que tome las variables.
5. Verifica `https://<tu-proyecto>.vercel.app/api/health`: debe responder `"sessionStore": "redis"`.

Diferencias frente a un servidor:

- **Sesiones:** cada mensaje puede llegar a otra instancia de la función, así que sin Redis la conversación y la confirmación de envío pueden perderse. En ese caso el envío queda **bloqueado** (nunca se envía sin confirmar), pero el usuario tendría que repetir la confirmación. Por eso Redis es obligatorio en Vercel.
- **Salidas:** se escriben en `/tmp/out` de la instancia y se pierden cuando esta se recicla. El agente las reporta igual, como `out/...`.
- **Tiempo:** cada petición tiene un máximo de 300 s (`maxDuration`). Un turno con muchas llamadas al modelo puede acercarse a ese límite; si pasa, baja `MAX_ITERACIONES`.
- **`MAX_TOKENS_GLOBAL`:** se cuenta por instancia, no para todo el despliegue.

Si la API responde `configuración incompleta: …`, falta una variable en el panel de Vercel. El detalle de cualquier error está en **Deployments → (el despliegue) → Logs**.

Para probar el build en local: `npm run build:vercel` (o `npx vercel build` + `npx vercel dev` si tienes la CLI de Vercel).

## Despliegue (Render)

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y selecciona el repo (usa `render.yaml` y el `Dockerfile`).
3. Carga `ANTHROPIC_API_KEY` y `ACCESS_KEY` en el panel de variables.
4. Verifica `https://<tu-servicio>.onrender.com/api/health`.

El plan gratuito se suspende tras un rato de inactividad: abre el link unos minutos antes de la defensa. `out/` es efímero en Render, lo cual es aceptable para el reto.

## Módulo reutilizable (bonus)

`npm run build:modulo` genera `modulo/` desde las mismas fuentes que usa la app: `agent.md` desde `agent/prompt.md`, `SKILL.md` desde `src/knowledge/registro-proveedor.md`, y `tools/proveedor.ts` re-exporta `src/tools/proveedor.ts`, sin copias. `tests/modulo.test.ts` falla si divergen.
