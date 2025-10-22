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
    } catch (err) {
      console.error("Error accediendo al micrófono:", err);
      alert("No se pudo acceder al micrófono");
    }
  } else if (mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    botonMicro.textContent = "🎤";
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
        console.log("Error servidor audio:", await resp.json());
        return;
      }
      const data = await resp.json();
      entrada.value = data.text;
      audioChunks = [];
    } catch (err) {
      console.error("Error enviando audio:", err);
    }
  }

  const pregunta = entrada.value.trim();
  if (!pregunta) return;

  contenedor.innerHTML += `<div class="mensaje usuario">${pregunta}</div>`;
  contenedor.scrollTop = contenedor.scrollHeight;
  entrada.value = "";

  const mensajeIA = document.createElement("div");
  mensajeIA.className = "mensaje ia";
  mensajeIA.textContent = "Pensando...";
  contenedor.appendChild(mensajeIA);
  contenedor.scrollTop = contenedor.scrollHeight;

  historial.push({ role: "user", content: pregunta });

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: historial }),
    });

    const data = await respuesta.json();
    mensajeIA.textContent = data.text;
    historial.push({ role: "assistant", content: data.text });
  } catch (err) {
    mensajeIA.textContent = "Error al conectar con el servidor";
    console.error(err);
  }

  contenedor.scrollTop = contenedor.scrollHeight;
});

// --- Enter para enviar mensaje ---
entrada.addEventListener("keypress", e => {
  if (e.key === "Enter") botonEnviar.click();
});
