let historial = [];
let mediaRecorder;
let audioChunks = [];

// --- Referencias del DOM ---
const entrada = document.getElementById("chati");
const contenedor = document.getElementById("respuesta");
const botonEnviar = document.getElementById("enviar");
const botonMicro = document.getElementById("mic");

// --- Función para iniciar grabación ---
botonMicro.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.start();
      botonMicro.textContent = "Detener grabación";
      console.log("Grabación iniciada");
    } catch (err) {
      console.error("Error accediendo al micrófono:", err);
      alert("No se pudo acceder al micrófono");
    }
  } else if (mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    botonMicro.textContent = "🎤";
    console.log("Grabación detenida");
  }
});

// --- Función para enviar audio o texto ---
botonEnviar.addEventListener("click", async () => {
  // Si hay audio grabado, enviarlo
  if (audioChunks.length > 0) {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("audio", blob, "grabacion.webm");

    try {
      const resp = await fetch("/api/voz", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json();
        console.log("Error servidor audio:", err);
        return;
      }
      const data = await resp.json();
      console.log("Transcripción recibida:", data.text);
      entrada.value = data.text;
      audioChunks = []; // limpiar
    } catch (err) {
      console.error("Error enviando audio:", err);
    }
  }

  // Enviar texto al chat
  const pregunta = entrada.value.trim();
  if (!pregunta) return;

  contenedor.innerHTML += `<div class="mensaje usuario">${pregunta}</div>`;
  contenedor.scrollTop = contenedor.scrollHeight;
  entrada.value = "";

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

    if (tipoContenido.includes("application/json")) {
      const data = await respuesta.json();
      mensajeIA.textContent = data.text;
      historial.push({ role: "assistant", content: data.text });
      return;
    }

    // SSE streaming
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
});

// --- Enter para enviar mensaje ---
entrada.addEventListener("keypress", e => {
  if (e.key === "Enter") botonEnviar.click();
});
