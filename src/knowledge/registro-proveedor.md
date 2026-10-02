# Conocimiento del proceso: registro como proveedor

## Para qué existe el proceso
Periferia IT Group recibe 8–12 solicitudes al mes de clientes en Colombia, Ecuador, Perú, Panamá y Honduras para registrarse como proveedor. La información pedida ya existe en el repositorio maestro; el trabajo es llenar el formulario del cliente, reunir los soportes y dejar el paquete listo para la firma del representante legal.

## Estados de un campo
- **lleno**: el valor sale del repositorio maestro; se indica la ruta del dato (p. ej. `representante_legal.nombre`).
- **faltante**: el dato no existe en el maestro o la etiqueta no tiene equivalente. Nunca se completa con un valor plausible.
- **requiere_confirmacion**: el mapeo tiene confianza menor a 0.8 o aplica una regla de país. Un humano debe confirmarlo antes de firmar.

## Identificador tributario por país (RN1)
| País | Código | Identificador |
|---|---|---|
| Colombia | CO | NIT |
| Ecuador | EC | RUC |
| Perú | PE | RUC |
| Panamá | PA | RUC |
| Honduras | HN | RTN |

Periferia solo tiene NIT colombiano. Para clientes fuera de Colombia el campo se llena con el NIT y queda en `requiere_confirmacion` con la nota "identificador extranjero". Si la plantilla usa una etiqueta genérica (p. ej. "Identificación tributaria"), se propone el equivalente del país del cliente.

## Datos bancarios (RN2)
Se llenan solo si la plantilla los pide de forma explícita. Nunca aparecen en el borrador de correo. En el chat se muestran enmascarados.

## Soportes (RN3)
- Un soporte exigido **ausente** bloquea `listo_para_firma`.
- Un soporte con `vigencia_hasta` anterior a la fecha de ejecución está **vencido** y bloquea `listo_para_firma`.
- Un campo faltante **no** bloquea, pero aparece en el checklist.
- Los soportes del repositorio son emitidos en Colombia. Si el cliente es de otro país, conviene confirmar que acepta documentos colombianos.

Tipos de soporte del repositorio: `camara_comercio` (certificado de existencia y representación legal, vigencia 30 días), `rut`, `certificacion_bancaria`, `parafiscales`, `estados_financieros`, `certificado_iso_9001`.

## Formatos de salida
- **xlsx**: cada etiqueta y su valor se escriben en la hoja y celda que indica la plantilla del cliente.
- **pdf**: todos los campos, con etiqueta y valor, en el orden de la plantilla.
- **portal**: no se automatiza. Se generan los valores en Markdown para que la analista los copie. El ingreso de credenciales y el clic en "Enviar" del portal son siempre humanos.

## Acciones externas (RN4)
El agente nunca firma, envía ni carga información en portales. "Enviar" en este sistema solo escribe un registro de envío simulado, y exige una confirmación explícita del usuario en el turno inmediatamente anterior.
