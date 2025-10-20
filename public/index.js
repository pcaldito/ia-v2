let historial = [];

// --- Referencias ---
const input = document.getElementById("chati");
const div = document.getElementById("respuesta");
const enviarBtn = document.getElementById("enviar");
const micBtn = document.getElementById("mic");

// --- Configurar reconocimiento de voz ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => micBtn.classList.add("listening");
  recognition.onend = () => micBtn.classList.remove("listening");

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join('');
    input.value = transcript;
    enviarMensaje();
  };

  recognition.onerror = (e) => console.error("Error micrófono:", e.error);
}

// --- Botón micrófono ---
micBtn.addEventListener("click", () => {
  if (recognition) recognition.start();
});

// --- Botón enviar ---
enviarBtn.addEventListener("click", () => enviarMensaje());

// --- Función enviar mensaje (tu código streaming intacto) ---
async function enviarMensaje() {
  const pregunta = input.value.trim();
  if (!pregunta) return;

  div.innerHTML += `<div class="mensaje usuario">${pregunta}</div>`;
  div.scrollTop = div.scrollHeight;
  input.value = "";

  const thinkingDiv = document.createElement("div");
  thinkingDiv.className = "mensaje ia";
  div.appendChild(thinkingDiv);
  div.scrollTop = div.scrollHeight;

  historial.push({ role: "user", content: pregunta });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: historial }),
    });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await res.json();
      thinkingDiv.textContent = data.text;
      historial.push({ role: "assistant", content: data.text });
      return;
    }

    // --- Streaming robusto ---
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let respuestaCompleta = "";
    let ultimoChar = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let fragment = line.slice(5).trim();
        if (fragment === "[DONE]") continue;

        // Saltos de línea
        fragment = fragment.replace(/###/g, "\n");
        
        if (ultimoChar && /[a-zA-Z0-9áéíóúñ]/.test(ultimoChar) && /^[a-zA-Z0-9áéíóúñ]/.test(fragment[0])) {
          fragment = " " + fragment;
        }

        if (respuestaCompleta && /[.,;:!¡¿?""'*+-]$/.test(respuestaCompleta) && fragment[0] && !/[\s\n]/.test(fragment[0])) {
          fragment = " " + fragment;
        }

        thinkingDiv.textContent += fragment;
        ultimoChar = fragment.slice(-1);
        respuestaCompleta += fragment;
        div.scrollTop = div.scrollHeight;
      }
    }

    historial.push({ role: "assistant", content: respuestaCompleta });
    console.log("Respuesta completa:", respuestaCompleta);

  } catch (error) {
    thinkingDiv.textContent = "Error al conectar con el servidor";
    console.error("Error:", error);
  }

  div.scrollTop = div.scrollHeight;
}
