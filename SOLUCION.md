# SOLUCIÓN · Reto 01 — Agente "Registro como Proveedor"

## 1. Problema en una frase

La analista administrativa de Periferia transcribe a mano, en 8 a 12 formularios al mes, datos que ya existen en el repositorio maestro, con riesgo de error en datos sensibles (NIT, cuenta bancaria) y dependiendo de una sola persona que sabe dónde está cada soporte. El dolor lo sienten la analista, por el retrabajo, y el negocio, porque un registro lento retrasa la facturación.

## 2. Arquitectura

```
┌──────────────────┐  POST /api/chat      ┌───────────────────────────────────────────────┐
│ web/ (HTML+JS)   │ ───────────────────▶ │ src/server.ts   API HTTP, sesiones en memoria │
│ - historial      │ ◀─────────────────── │        │                                      │
│ - tool calls     │  reply, toolCalls,   │        ▼                                      │
│ - confirmación   │  needsConfirmation   │ src/agent/ciclo.ts   ciclo + guardia RN4      │
└──────────────────┘                      │        │                    │                 │
                                          │        ▼                    ▼                 │
                                          │ src/llm/adapter.ts   src/tools/registro.ts    │
                                          │  └ anthropic.ts       (zod, logs, nunca lanza)│
                                          │                             │                 │
                                          │                      src/tools/proveedor.ts   │
                                          └─────────────────────────────┼─────────────────┘
                                                     ┌──────────────────┴──────────────┐
                                              fixtures/reto-01 (lectura)      out/ (escritura)
```

| Capa | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, reglas que no se rompen, flujo, formato del resumen, protocolo de confirmación |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` y `src/knowledge/reglas.json` | Proceso, identificador por país, umbrales de confianza, rutas sensibles y bancarias |
| **Ejecución** | `src/tools/proveedor.ts` (+ `lib/`) | Las 5 herramientas: la única fuente de valores |

El prompt y el conocimiento se combinan al iniciar el servidor. Las herramientas leen las reglas de `reglas.json`: cambiar, por ejemplo, el umbral de confianza o el identificador de un país no toca ni el servidor ni el código de las herramientas.

## 3. Ciclo del agente

`src/agent/ciclo.ts`, método `turno(sesion, mensaje)`:

1. Agrega el mensaje del usuario y llama al adaptador con el historial y las definiciones de herramientas (JSON Schema generado desde zod).
2. Si el modelo pide herramientas, el registro (`src/tools/registro.ts`) valida los argumentos con zod, ejecuta, guarda la llamada en `out/log.jsonl` y en `out/<caso>/log.jsonl`, y devuelve el resultado al modelo. Si los argumentos no cumplen, el error vuelve al modelo como `{ ok: false }`.
3. Repite hasta que el modelo responde sin pedir herramientas, o hasta el **tope de 25 iteraciones** (`MAX_ITERACIONES`). Al llegar al tope, responde con lo último que tenía, las herramientas ejecutadas y cómo continuar (CA1).
4. Antes de cada llamada verifica el **tope de tokens por sesión** y el **presupuesto global** del proceso.
5. Si el proveedor falla (timeout, clave, límite de tasa), el historial vuelve al estado previo al turno y el chat muestra un mensaje claro. La sesión sigue viva (CA5).

**Confirmación humana (RN4/CA3).** No depende de que el modelo obedezca el prompt:

- `proveedor_simular_envio` con `confirmado: false` devuelve "requiere confirmación explícita". El backend marca ese caso como **pendiente** y responde `needsConfirmation: true`; el front resalta el estado con botones de confirmar y cancelar.
- La marca vale **solo para el siguiente mensaje** del usuario y **solo para ese caso**.
- Si el modelo llama con `confirmado: true`, el backend solo ejecuta si había una marca pendiente para ese caso y el mensaje del usuario es una confirmación explícita (`evaluarConfirmacion`). Si no, **bloquea la llamada sin ejecutarla**, la registra en el log como bloqueada y deja una nueva marca pendiente para que el agente vuelva a preguntar.
- Se rechazan respuestas ambiguas ("ok", "dale", "listo", "envía"), preguntas, negaciones y confirmaciones con condiciones ("sí, pero cambia…").

## 4. Elección del modelo

| | |
|---|---|
| Proveedor | Anthropic |
| Modelo | `claude-sonnet-5-5` (configurable con `LLM_MODEL`) |
| Por qué | Uso de herramientas confiable en flujos de varios pasos, buen seguimiento de instrucciones en español y costo intermedio. Para este caso de uso, con mapeo determinista en las herramientas, no hace falta un modelo de la gama más alta. |
| Precio | US$2 por millón de tokens de entrada y US$10 por millón de salida (fuente: página de precios de Anthropic, consultada el 2026-10-02) |

**Costo estimado por caso.** Medido sobre el contexto real de la app: el system prompt (prompt + conocimiento) ocupa unos 6 000 caracteres, las definiciones de herramientas unos 3 300, y los resultados de las cuatro herramientas de un caso hasta 5 800. Procesar un caso toma unas 5 llamadas al modelo con contexto creciente:

| Concepto | Tokens aprox. | Costo |
|---|---|---|
| Entrada (5 llamadas) | ~19 000 | US$0,038 |
| Salida (llamadas a herramientas + resumen) | ~1 000 | US$0,010 |
| **Procesar un caso** | | **≈ US$0,05** |
| Pedir y confirmar el envío (2 turnos más) | | + ≈ US$0,03 |

Con 8 a 12 casos al mes, el costo es menor a US$1 mensual. Con *prompt caching* del system prompt y las herramientas, la entrada repetida bajaría a una fracción.

## 5. Diseño del portal web (§7.4)

**Hoy:** `proveedor_generar_formulario` responde "formato no soportado: portal web" y produce `out/<caso>/valores-portal.md`, con cada campo, su valor y su estado, la URL del portal tomada de la solicitud y los pasos humanos.

**Estrategia propuesta:** un **navegador controlado con asistencia humana** (Playwright en modo visible o una extensión de navegador), no RPA ciego.

| Paso | Quién | Cómo |
|---|---|---|
| Abrir el portal e iniciar sesión | **Humano** | La analista abre la sesión del navegador y escribe usuario, contraseña y MFA. El agente nunca ve ni recibe las credenciales. |
| Ubicar campos | Agente | Mapea las etiquetas visibles del formulario web con la misma lógica de `mapear_campos` (glosario + similitud). |
| Llenar campos | Agente, con revisión | Llena solo los campos `lleno`. Los `faltante` y `requiere_confirmacion` quedan resaltados en pantalla. |
| Cargar soportes | Agente, con revisión | Adjunta los archivos del paquete; la analista verifica. |
| Clic en "Enviar" | **Humano** | Siempre. El agente se detiene en la pantalla previa al envío. |

**Credenciales:** las entrega el cliente al representante legal. No viven en el repositorio, ni en el prompt, ni en los logs, ni en el backend; se escriben directamente en el navegador. Si en una fase posterior se quisiera guardarlas, iría a un gestor de secretos (Azure Key Vault o 1Password Business) con acceso por rol y auditoría, y el agente usaría una referencia sin ver el valor.

**Límites y mitigaciones:**
- **CAPTCHA y MFA:** se resuelven siempre por el humano; no se intenta saltarlos.
- **Cambios de layout:** se buscan los campos por etiqueta visible y no por selectores frágiles. Si la confianza del mapeo baja del umbral, se cae al modo `valores-portal.md`.
- **Términos de uso del portal:** algunos prohíben la automatización; por eso el modo por defecto sigue siendo copiar y pegar asistido.
- **Sesiones que expiran:** el agente detecta el retorno a la pantalla de login y le devuelve el control al humano.

## 6. Decisiones y trade-offs

1. **Los valores del formulario salen siempre del maestro; el mapeo que envía el modelo solo se verifica.** `generar_formulario` recibe `{ caso, mapeo }` como pide el contrato, pero recalcula el mapeo desde la plantilla y el maestro, y reporta como `discrepancias` lo que el modelo haya dicho distinto. *Descartado:* escribir lo que el modelo pasa en `mapeo`. Habría permitido que un valor plausible pero inventado llegara al formulario, el riesgo principal que señala el PRD. Con este diseño, CA2 se cumple por construcción.
2. **La confirmación se aplica en el backend con una regla estructural.** El backend marca "pendiente" cuando se intentó un envío y el siguiente mensaje no es una confirmación válida. *Descartado:* confiar solo en el prompt, o detectar en el texto del modelo si hizo la pregunta. Lo primero depende del modelo; lo segundo es frágil ante cambios de redacción.
3. **Confianza del mapeo por similitud léxica determinista** (Dice sobre palabras, con tolerancia singular/plural), umbral de 0.8 para llenar y 0.6 para sugerir. *Descartado:* pedirle al LLM que mapee o usar embeddings. Serían menos reproducibles, más caros y difíciles de testear; con el glosario entregado, los 4 casos se resuelven con coincidencia exacta y la similitud solo actúa como red de seguridad. Lo que no alcanza el umbral queda `faltante` o `requiere_confirmacion`, nunca inventado.
4. **`requiere_confirmacion` por baja confianza no se escribe en el formulario; por regla de país sí.** RN1 exige llenar el NIT en RUC/RTN, pero un mapeo dudoso escrito en un documento para firma es más peligroso que un campo vacío y resaltado.
5. **`node:http` sin framework y front en HTML sin build.** Son tres rutas y un chat. *Descartado:* Express/Hono y React+Vite. Agregarían dependencias y un paso de build sin aportar al reto, y el código queda más corto de defender. El Markdown se renderiza con un renderizador local que escapa todo el HTML, en lugar de librerías por CDN: un fallo de red en la defensa no rompe el chat.
6. **Datos sensibles enmascarados hacia el modelo** (número de cuenta y cédula del representante): el modelo ve `****2345`, y el formulario recibe el valor completo desde el maestro. *Descartado:* mostrar todo al modelo. No lo necesita para su trabajo, y así esos datos no viajan al proveedor de lenguaje ni aparecen en el chat.
7. **Sin streaming.** El indicador de "trabajando" muestra los segundos transcurridos. *Descartado* por ahora: el streaming es opcional en el PRD y complica el manejo de errores a mitad de turno.

## 7. Supuestos

1. **Fecha de ejecución = hoy en America/Bogota.** Con fechas posteriores al 2026-09-30 la Cámara de Comercio está vencida, y **ningún caso queda listo para firma**; es el comportamiento correcto según RN3. `FECHA_EJECUCION` permite simular otra fecha (con 2026-09-15, `co-industrias-delta` queda listo).
2. **Un soporte que vence el mismo día de la ejecución sigue vigente** ("anterior a la fecha de ejecución" se interpreta como estrictamente anterior).
3. **El envío simulado se permite aunque el paquete no esté listo**, si el humano lo confirma de forma explícita. El agente lo advierte en la pregunta, y `ENVIO-SIMULADO.md` registra el estado. Así lo pide el ejemplo de la sección 11, donde `ec-corp-andina` no está listo y aun así se espera el archivo tras confirmar.
4. **Los soportes exigidos salen de `soportes-exigidos.json`**, no de interpretar el cuerpo del correo. El cuerpo se entrega al modelo solo como contexto y se trata como dato, no como instrucción.
5. **El formulario Excel se genera desde cero** con la estructura de `plantilla-celdas.json`, porque el archivo original del cliente no viene en los fixtures.
6. **El NIT se escribe sin dígito de verificación**, tal como está en el maestro; el DV se llena solo si la plantilla lo pide como campo propio.
7. **`valores-portal.md` incluye datos bancarios** porque la plantilla del portal los pide explícitamente (RN2). El borrador de correo nunca los incluye.
8. **Un caso de portal también arma el paquete** (soportes y checklist), porque el portal pide cargar soportes.
9. **Los soportes del repositorio son colombianos;** para clientes de otros países se agrega una observación en el checklist para confirmar que los aceptan. No bloquea la firma.
10. **Re-armar un paquete invalida un envío simulado anterior,** y no se permiten dos envíos del mismo paquete.

## 8. Cobertura

| Historia | Estado | Evidencia |
|---|---|---|
| HU-1 Leer la solicitud | Hecho | País, cliente, formato, campos, soportes; identificador ambiguo o extranjero propuesto por país |
| HU-2 Mapear al maestro | Hecho | Estados `lleno` (con ruta) / `faltante` / `requiere_confirmacion`, confianza, glosario |
| HU-3 Formulario P0 xlsx | Hecho | Celda por celda según la plantilla (test verifica cada celda) |
| HU-3 Formulario P1 pdf | Hecho | Todos los campos, en orden, con etiqueta y valor |
| HU-3 P2 portal | Hecho (diseño) | `valores-portal.md` + diseño en la sección 5 |
| HU-4 Paquete para firma | Hecho | Formulario, soportes, `checklist.md`, `borrador-correo.md`, vigencias, confirmación, `ENVIO-SIMULADO.md` |
| HU-5 Manejo de errores | Hecho | `{ ok, data }` sin excepciones; plantilla corrupta, caso inexistente y formato no soportado continúan con lo posible |
| CA1–CA5 | Hecho | Tope de iteraciones, valores solo de herramientas, confirmación en backend, logs, errores claros |
| RN1–RN5 | Hecho | Tests dedicados por regla |
| Bonus §9.4 | Hecho | `modulo/` generado desde las mismas fuentes, con test de no divergencia |
| Link público | Pendiente de despliegue | Dockerfile y `render.yaml` listos |

**Qué falta para producción:**
- Leer las plantillas reales del cliente (`.xlsx` y `.pdf` adjuntos) y escribir sobre ellas, en vez de partir de una plantilla en JSON.
- Rellenar AcroForms cuando el PDF los tenga.
- Persistir sesiones y salidas en almacenamiento durable (hoy viven en memoria y en un disco efímero).
- Autenticación real y auditoría por usuario.
- *Prompt caching* y streaming.
- Integración con correo y firma electrónica (fuera del alcance de este reto).

## 9. Uso de IA

> ⚠️ Andrés: revisa y ajusta esta sección para que refleje exactamente lo que hiciste; se evalúa.

| Asistente | Para qué |
|---|---|
| Claude (Anthropic, en claude.ai) | Revisión del prompt inicial del agente; análisis de brecha entre una primera versión y el PRD; diseño de la arquitectura; generación del código de herramientas, ciclo, servidor, adaptador y front; tests; capturas de pantalla para revisar el front; redacción de README y SOLUCIÓN |
| `[completa si usaste otros asistentes]` | |

**Lo que descarté de lo que me propuso la IA, y por qué:**
- **Una primera versión completa construida antes de tener el PRD y los fixtures** (datos inventados, servidor MCP, suite de evals en YAML, CLI). No cumplía el contrato de herramientas ni las rutas de salida, y estaba probada contra datos que no eran los oficiales. La reconstruí desde cero sobre los fixtures; solo conservé ideas: guardias en backend, enmascarado y detección de datos bancarios.
- **Una regla de confirmación muy estricta** que rechazaba "sí, confirmo" porque no mencionaba la palabra "envío". Después de una pregunta explícita, "sí" es una confirmación clara; se mantiene el rechazo de "ok", "dale" y "listo", que suelen ser acuses de recibo.
- **Bloquear el envío si el paquete no está listo.** Contradecía el ejemplo de la sección 11; ahora se advierte y decide el humano.
- **Librerías de Markdown por CDN en el front.** No cargaron en una prueba sin red; se reemplazaron por un renderizador local.
- **Aceptar los valores del mapeo que envía el modelo** a `generar_formulario` (ver decisión 1).

**Errores que la IA cometió y detecté en pruebas:**
- El indicador de "pensando" se mostraba siempre: el CSS anulaba el atributo `hidden`.
- El servidor no arrancaba con `.env.example` copiado tal cual, por las variables vacías; ahora cuentan como no definidas.
- Un comando de limpieza que se terminaba a sí mismo.

Puedo explicar cada archivo del repositorio; el recorrido sugerido para la defensa es `src/tools/proveedor.ts` → `src/tools/registro.ts` → `src/agent/ciclo.ts` → `src/llm/`.

## 10. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| El modelo "completa" un campo con un valor plausible | Los valores solo salen del maestro (decisión 1); el prompt lo prohíbe; los faltantes se listan en el checklist |
| Instrucciones maliciosas dentro de un correo o una plantilla (*prompt injection*) | El contenido del caso es dato; las herramientas no ejecutan comandos de shell ni escriben fuera de `out/`; el envío exige confirmación verificada por el backend |
| Datos personales y bancarios enviados al proveedor LLM | Enmascarado de cuenta y cédula hacia el modelo; en producción, acuerdo de tratamiento de datos con el proveedor y revisión de qué otros campos enmascarar |
| Uso sin límite de la clave | Topes por turno, por sesión y global; `ACCESS_KEY` en el link; en producción, autenticación real y límites por usuario |
| Maestro desactualizado o soportes vencidos | Vigencias evaluadas en cada ejecución; en producción, un dueño del dato y alertas de vencimiento (la Cámara de Comercio dura 30 días) |
| Plantillas reales más desordenadas que los fixtures | Lo que no alcanza el umbral queda `faltante` o `requiere_confirmacion`; ampliar el glosario con cada caso nuevo |
| Dependencia de un solo proveedor de modelo | Interfaz `AdaptadorLLM`: agregar otro proveedor es un archivo nuevo sin tocar el ciclo |
| Pérdida de sesiones y salidas al reiniciar | En producción, almacenamiento durable y retención definida para los logs |
| Firma de documentos con datos por confirmar | El checklist los lista; el paso de firma es humano y debe revisarlos antes |
