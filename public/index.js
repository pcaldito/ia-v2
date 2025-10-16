let historial = [];

document.getElementById("enviar").addEventListener("click", async () => {
  const input = document.getElementById("chati");
  const pregunta = input.value.trim();
  const div = document.getElementById("respuesta");

  if (!pregunta) return;

  // Mostrar pregunta del usuario
  div.innerHTML += `<div class="mensaje usuario">${pregunta}</div>`;
  div.scrollTop = div.scrollHeight;
  input.value = "";

  // Mostrar mensaje de carga
  const thinkingDiv = document.createElement("div");
  thinkingDiv.className = "mensaje ia";
  thinkingDiv.textContent = "Pensando...";
  div.appendChild(thinkingDiv);
  div.scrollTop = div.scrollHeight;

  // Añadir al historial
  historial.push({ role: "user", content: pregunta });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: historial }),
    });

    const data = await res.json();
    const respuesta = data.text || "Error al obtener respuesta";

    thinkingDiv.textContent = respuesta;
    historial.push({ role: "assistant", content: respuesta });

  } catch (error) {
    thinkingDiv.textContent = "Error al conectar con el servidor";
    console.error("Error:", error);
  }

  div.scrollTop = div.scrollHeight;
});
