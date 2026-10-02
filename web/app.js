// Front de chat sin build. Muestra cada llamada a herramienta y resalta cuando el agente pide confirmación.
const $ = (id) => document.getElementById(id)
const conversacion = $("conversacion")
const entrada = $("entrada")
const botonEnviar = $("enviar")
let sessionId = sessionStorage.getItem("sessionId") || undefined
let claveAcceso = sessionStorage.getItem("claveAcceso") || ""
let ocupado = false

function escapar(texto) {
  const d = document.createElement("div")
  d.textContent = texto
  return d.innerHTML
}

// Markdown mínimo y seguro: se escapa todo el HTML primero y luego se aplican solo estas marcas.
function enLinea(t) {
  return t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
}

function markdown(texto) {
  const lineas = escapar(texto).split("\n")
  const html = []
  let lista = false
  let codigo = false
  let tabla = []
  const cerrarLista = () => { if (lista) { html.push("</ul>"); lista = false } }
  const cerrarTabla = () => {
    if (!tabla.length) return
    const filas = tabla.filter((f) => !/^\|?\s*:?-{3,}/.test(f)).map((f) => f.replace(/^\||\|$/g, "").split("|").map((c) => enLinea(c.trim())))
    const [cab, ...cuerpo] = filas
    html.push(`<table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${cuerpo.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`)
    tabla = []
  }
  for (const linea of lineas) {
    if (linea.trim().startsWith("```")) { cerrarLista(); cerrarTabla(); html.push(codigo ? "</pre>" : "<pre>"); codigo = !codigo; continue }
    if (codigo) { html.push(linea + "\n"); continue }
    if (/^\s*\|.*\|\s*$/.test(linea)) { cerrarLista(); tabla.push(linea.trim()); continue }
    cerrarTabla()
    const titulo = linea.match(/^(#{1,4})\s+(.*)$/)
    if (titulo) { cerrarLista(); html.push(`<h3>${enLinea(titulo[2])}</h3>`); continue }
    const item = linea.match(/^\s*[-*]\s+(.*)$/) || linea.match(/^\s*\d+\.\s+(.*)$/)
    if (item) { if (!lista) { html.push("<ul>"); lista = true } html.push(`<li>${enLinea(item[1])}</li>`); continue }
    cerrarLista()
    if (linea.trim()) html.push(`<p>${enLinea(linea)}</p>`)
  }
  cerrarLista(); cerrarTabla(); if (codigo) html.push("</pre>")
  return html.join("")
}

function resumenJson(valor) {
  try { return JSON.stringify(valor, null, 2) } catch { return String(valor) }
}

function renderLlamadas(llamadas) {
  if (!llamadas.length) return null
  const caja = document.createElement("div")
  caja.className = "herramientas"
  for (const l of llamadas) {
    const det = document.createElement("details")
    det.className = "llamada"
    const pendiente = !l.ok && !l.bloqueada && l.resumen.startsWith("requiere confirmación")
    const marca = l.bloqueada ? ["bloqueada", "bloqueada por el backend"] : l.ok ? ["ok", "ok"] : pendiente ? ["pendiente", "pide confirmación"] : ["error", "error"]
    det.innerHTML = `<summary><span class="nombre">${escapar(l.nombre)}</span><span class="marca ${marca[0]}">${marca[1]}</span><span>${escapar(l.resumen)}</span></summary>
      <pre>argumentos: ${escapar(resumenJson(l.args))}\n\nresultado: ${escapar(l.resumen)}</pre>`
    caja.appendChild(det)
  }
  return caja
}

function renderConfirmacion() {
  const caja = document.createElement("div")
  caja.className = "confirmacion"
  caja.innerHTML = `<strong>Pendiente de tu confirmación</strong>
    <p>El agente no hará el envío simulado hasta que lo confirmes en tu próximo mensaje.</p>
    <div class="acciones">
      <button type="button" class="boton-confirmar">Sí, confirmo el envío</button>
      <button type="button" class="boton-secundario">No, no enviar</button>
    </div>`
  const [si, no] = caja.querySelectorAll("button")
  si.addEventListener("click", () => enviar("Sí, confirmo el envío"))
  no.addEventListener("click", () => enviar("No, no envíes nada"))
  return caja
}

function agregarTurno(rol, texto, llamadas = [], pideConfirmacion = false) {
  $("vacio")?.remove()
  document.querySelectorAll(".confirmacion:not(.resuelta)").forEach((c) => c.classList.add("resuelta"))
  const turno = document.createElement("article")
  turno.className = `turno ${rol}`
  const herramientas = renderLlamadas(llamadas)
  if (herramientas) turno.appendChild(herramientas)
  const cuerpo = document.createElement("div")
  cuerpo.className = "texto"
  cuerpo.innerHTML = rol === "usuario" ? escapar(texto) : markdown(texto)
  turno.appendChild(cuerpo)
  if (pideConfirmacion) turno.appendChild(renderConfirmacion())
  conversacion.appendChild(turno)
  turno.scrollIntoView({ behavior: "smooth", block: "end" })
}

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { ...opciones, headers: { "content-type": "application/json", "x-access-key": claveAcceso, ...(opciones.headers || {}) } })
  if (r.status === 401) { pedirClave(); throw new Error("Se necesita la clave de acceso.") }
  const datos = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`)
  return datos
}

function marcarOcupado(si) {
  ocupado = si
  botonEnviar.disabled = si
  $("pensando").hidden = !si
  if (si) {
    const inicio = Date.now()
    marcarOcupado.timer = setInterval(() => { $("segundos").textContent = `${Math.round((Date.now() - inicio) / 1000)} s` }, 500)
  } else clearInterval(marcarOcupado.timer)
}

async function enviar(texto) {
  const mensaje = texto.trim()
  if (!mensaje || ocupado) return
  agregarTurno("usuario", mensaje)
  entrada.value = ""
  marcarOcupado(true)
  try {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ sessionId, message: mensaje }) })
    sessionId = r.sessionId
    sessionStorage.setItem("sessionId", sessionId)
    agregarTurno(r.error ? "sistema" : "agente", r.reply, r.toolCalls, r.needsConfirmation)
  } catch (e) {
    agregarTurno("sistema", `No se pudo completar la solicitud: ${e.message}`)
  } finally {
    marcarOcupado(false)
    entrada.focus()
  }
}

function pedirClave() {
  const d = $("dialogo-clave")
  if (!d.open) d.showModal()
}

$("form-clave").addEventListener("submit", () => {
  claveAcceso = $("clave").value
  sessionStorage.setItem("claveAcceso", claveAcceso)
})

$("formulario").addEventListener("submit", (e) => { e.preventDefault(); enviar(entrada.value) })
entrada.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(entrada.value) } })
document.querySelector(".ejemplo").addEventListener("click", (e) => enviar(e.currentTarget.dataset.texto))
$("nueva").addEventListener("click", () => { sessionStorage.removeItem("sessionId"); location.reload() })

async function iniciar() {
  try {
    const salud = await fetch("/api/health").then((r) => r.json())
    $("estado-modelo").textContent = `Modelo: ${salud.provider} / ${salud.model}`
    for (const caso of salud.casos || []) {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = caso
      b.addEventListener("click", () => enviar(`Procesa el caso "${caso}"`))
      $("casos").appendChild(b)
    }
    if (salud.requiresAccessKey && !claveAcceso) pedirClave()
  } catch {
    $("estado-modelo").textContent = "Sin conexión con el backend"
  }
  if (!sessionId) return
  try {
    const s = await api(`/api/sessions/${sessionId}`)
    s.historial.forEach((ev, i) => agregarTurno(ev.rol, ev.texto, ev.toolCalls, ev.needsConfirmation && i === s.historial.length - 1))
  } catch {
    sessionStorage.removeItem("sessionId")
    sessionId = undefined
  }
}
iniciar()
