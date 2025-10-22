let historial = [];

// --- Referencias del DOM ---
const entrada = document.getElementById("chati");
const contenedor = document.getElementById("respuesta");
const botonEnviar = document.getElementById("enviar");
const botonMicro = document.getElementById("mic");

// --- Configurar reconocimiento de voz ---
const ReconocimientoVoz = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconocimiento;

if (ReconocimientoVoz) {
  reconocimiento = new ReconocimientoVoz();
  reconocimiento.lang = 'es-ES';
  reconocimiento.interimResults = false;
  reconocimiento.continuous = false;

  reconocimiento.onstart = () => botonMicro.classList.add("escuchando");
  reconocimiento.onend = () => botonMicro.classList.remove("escuchando");

  reconocimiento.onresult = (evento) => {
    const texto = Array.from(evento.results)
      .map(resultado => resultado[0].transcript)
      .join('');
    entrada.value = texto;
    enviarMensaje();
  };

  reconocimiento.onerror = (e) => console.error("Error micrófono:", e.error);
}

// --- Botón micrófono ---
botonMicro.addEventListener("click", () => {
  if (reconocimiento) reconocimiento.start();
});

// --- Botón enviar ---
botonEnviar.addEventListener("click", () => enviarMensaje());
entrada.addEventListener("keypress", (e) => {
  if (e.key === "Enter") enviarMensaje();
});

// --- Función principal: enviar mensaje ---
async function enviarMensaje() {
  const pregunta = entrada.value.trim();
  if (!pregunta) return;

  // Mostrar mensaje del usuario
  contenedor.innerHTML += `<div class="mensaje usuario">${pregunta}</div>`;
  contenedor.scrollTop = contenedor.scrollHeight;
  entrada.value = "";

  // Crear elemento para mostrar la respuesta de la IA
  const mensajeIA = document.createElement("div");
  mensajeIA.className = "mensaje ia";
  contenedor.appendChild(mensajeIA);
  contenedor.scrollTop = contenedor.scrollHeight;

  historial.push({ role: "user", content: pregunta });

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: historial }),
    });

    const tipoContenido = respuesta.headers.get("content-type") || "";

    // Si es una respuesta directa (sin streaming)
    if (tipoContenido.includes("application/json")) {
      const data = await respuesta.json();
      mensajeIA.textContent = data.text;
      historial.push({ role: "assistant", content: data.text });
      return;
    }

    // --- Manejo de streaming SSE ---
    const lector = respuesta.body.getReader();
    const decodificador = new TextDecoder("utf-8");
    let buffer = "";
    let respuestaCompleta = "";
    let ultimoCaracter = "";

    while (true) {
      const { done, value } = await lector.read();
      if (done) break;

      buffer += decodificador.decode(value, { stream: true });
      const lineas = buffer.split("\n");
      buffer = lineas.pop() || "";

      for (const linea of lineas) {
        if (!linea.startsWith("data:")) continue;
        let fragmento = linea.slice(5).trim();
        if (fragmento === "[DONE]") continue;

        // Manejar saltos de línea
        fragmento = fragmento.replace(/###/g, "\n");

        // Espaciado automático entre palabras
        if (ultimoCaracter && /[a-zA-Z0-9áéíóúñ]/.test(ultimoCaracter) && /^[a-zA-Z0-9áéíóúñ]/.test(fragmento[0])) {
          fragmento = " " + fragmento;
        }

        if (respuestaCompleta && /[.,;:!¡¿?""'*+-]$/.test(respuestaCompleta) && fragmento[0] && !/[\s\n]/.test(fragmento[0])) {
          fragmento = " " + fragmento;
        }

        mensajeIA.textContent += fragmento;
        ultimoCaracter = fragmento.slice(-1);
        respuestaCompleta += fragmento;
        contenedor.scrollTop = contenedor.scrollHeight;
      }
    }

    historial.push({ role: "assistant", content: respuestaCompleta });
    console.log("Respuesta completa:", respuestaCompleta);

  } catch (error) {
    mensajeIA.textContent = "Error al conectar con el servidor";
    console.error("Error:", error);
  }

  contenedor.scrollTop = contenedor.scrollHeight;
}
