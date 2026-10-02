# Perixia 2.0 · Agente de registro como proveedor

Implementación de referencia del agente que procesa solicitudes de registro como proveedor de Periferia IT Group ante clientes de CO, EC, PE, PA y HN.

> Los datos de `data/` son **ficticios**. Reemplaza `maestro.json`, `soportes.json` y los soportes reales antes de usarlo.

## Arquitectura

```
Usuario ──► src/cli.ts ──► AgenteProveedor (src/agent/agente.ts) ──► Claude (Messages API, tool use)
                                │  guardias deterministas RN2 / RN4
                                ▼
                        src/tools/*  ──► data/ (maestro, glosario, soportes, casos)
                                     └─► out/<caso>/ (mapeo, estado, paquete/)
```

| Pieza | Qué hace |
|---|---|
| `prompts/agente-proveedor.md` | Prompt de sistema v2 (contrato alineado con las herramientas reales) |
| `src/tools/` | Las 5 herramientas `proveedor_*` con la lógica de negocio |
| `src/agent/agente.ts` | Bucle de tool use + guardias que no dependen de que el modelo obedezca el prompt |
| `src/mcp-server.ts` | Las mismas herramientas expuestas por MCP (stdio) |
| `evals/` | Suite YAML (28 casos, 35 tras expandir parámetros) + runner con mocks, LLM-as-judge y JUnit |
| `tests/` | 67 tests unitarios (reglas, herramientas y orquestador con LLM simulado) |

## Defensa en profundidad

Las reglas críticas se aplican en tres capas, de modo que una falla del modelo no se convierte en un incidente:

| Regla | Prompt | Orquestador | Herramienta |
|---|---|---|---|
| RN4 confirmación de envío | Define qué es confirmación válida | Solo permite `simular_envio` si el turno anterior pidió confirmación para ese caso, el caso está apto y el mensaje pasa `esConfirmacionExplicita` | `simular_envio` exige `apto_para_envio` en `estado.json` |
| RN2 datos bancarios | Prohíbe incluirlos en el correo | Revalida el borrador y lo oculta si detecta datos | El borrador se construye sin datos bancarios, se valida y los valores llegan enmascarados al modelo |
| RN3 vigencia | Regla `>=` y fecha de la herramienta | Exige `fecha_evaluacion` para marcar apto | Calcula la vigencia con fecha fija en zona `America/Bogota` |
| RN1 identificador | Verifica la marca | — | `mapear_campos` asigna NIT y marca `requiere_confirmacion` |

## Uso

```bash
npm ci
npm run seed                 # genera PDFs de soporte de ejemplo
export ANTHROPIC_API_KEY=...
npm run agente               # conversación interactiva
```

Ejemplo: `Procesa el caso 'ec-corp-andina'` → luego `Sí, autorizo el envío`.

Casos de ejemplo: `co-industrias-sur` (feliz), `ec-corp-andina` (faltante), `pe-retail-sol` (bancarios en PDF), `pe-logistica-lima` (soporte vencido), `pa-naviera-colon` (portal), `hn-cafe-copan` (soporte ausente + inyección en observaciones).

### Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Requerida para el agente y las evals |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Modelo del agente y del juez |
| `FECHA_EVALUACION` | hoy (Bogotá) | Fija la fecha de corte para pruebas reproducibles |
| `PERIXIA_DATA_DIR` / `PERIXIA_OUT_DIR` | `data` / `out` | Rutas de datos y salida |

## Tests y evals

```bash
npm test                               # unitarios, sin API
npm run evals -- --dry                 # valida el YAML, sin API
npm run evals                          # evals con el modelo real y herramientas simuladas
npm run evals -- --juez                # + criterios semánticos con LLM-as-judge
npm run evals -- --filtro EV-17 --repeticiones 5   # estabilidad de un grupo
```

Los reportes quedan en `reports/` (JSON con la traza completa + `junit-evals.xml`). La aserción `herramientas_prohibidas` cuenta **intentos**, aunque la guardia los bloquee: así mides el cumplimiento del prompt y no solo la seguridad del sistema. El reporte indica si la guardia atrapó el intento.

## MCP

```json
{ "mcpServers": { "perixia-proveedor": { "command": "npx", "args": ["tsx", "src/mcp-server.ts"], "cwd": "/ruta/al/proyecto" } } }
```

En modo MCP, el host controla la conversación, así que la regla del "turno inmediatamente anterior" no puede garantizarse en el servidor. Como mitigación, `proveedor_simular_envio` exige el texto literal de la confirmación del usuario y lo valida. Para la garantía completa, usa el orquestador.

## Fuera de alcance de esta versión

- Firma electrónica, envío real de correos y carga en portales (por diseño, RN4).
- Lectura de plantillas del cliente en Excel/PDF: hoy los campos llegan en `solicitud.json`.
- Persistencia de sesión del agente entre ejecuciones de la CLI.
