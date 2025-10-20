import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import mammoth from "mammoth";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "Eres un asistente amable y claro.";

let vectorStore = [];

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

const VECTOR_FILE = "./vectorStore.json";

async function cargarDocumentos() {
  if (fs.existsSync(VECTOR_FILE)) {
    vectorStore = JSON.parse(fs.readFileSync(VECTOR_FILE, "utf-8"));
    return;
  }

  const files = fs.readdirSync("./docs").filter(f => f.endsWith(".docx"));

  for (const file of files) {
    const buffer = fs.readFileSync(`./docs/${file}`);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value;

    for (let i = 0; i < text.length; i += 500) {
      const chunk = text.slice(i, i + 500);
      const emb = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk,
      });
      vectorStore.push({
        id: `${file}-${i}`,
        text: chunk,
        embedding: emb.data[0].embedding,
        source: file,
      });
    }
  }

  fs.writeFileSync(VECTOR_FILE, JSON.stringify(vectorStore));
}

await cargarDocumentos();

const DOCUMENT_KEYWORDS = [
  "arquitectura", "gótica",
  "veterinaria", "vet", "animales",
  "league of legends", "lol", "tft", "builds", "campeones"
];

function conversacion(question) {
  const qLower = question.toLowerCase();
  return DOCUMENT_KEYWORDS.some(k => qLower.includes(k.toLowerCase()));
}

// --- Definición centralizada de funciones ---
const funciones = [
  {
    name: "saluda",
    keywords: ["saludame", "hola"],
    execute: () => "¡Hola Pablo! Encantado de saludarte 😊"
  },
  {
    name: "tiempo",
    keywords: ["tiempo", "clima"],
    execute: () => "El tiempo en Badajoz es soleado con 25°C. Si me equivoco, mira por la ventana 😉"
  }
  // Aquí puedes añadir más funciones fácilmente
];

function detectFunction(message) {
  const msgLower = message.toLowerCase();
  return funciones.find(fn => fn.keywords.some(k => msgLower.includes(k)));
}

app.post("/api/chat", async (req, res) => {
  const { messages = [] } = req.body;

  try {
    const ultimoMensaje = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

    // --- Detectar si alguna función aplica ---
    const fn = detectFunction(ultimoMensaje);
    if (fn) {
      const respuesta = fn.execute();
      return res.json({ text: respuesta });
    }

    // --- Lógica normal de embeddings y OpenAI ---
    let context = "";
    if (conversacion(ultimoMensaje)) {
      const qEmbedding = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: ultimoMensaje,
      });
      const queryVector = qEmbedding.data[0].embedding;

      const scored = vectorStore.map(chunk => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.embedding),
      }));

      const topChunks = scored.sort((a, b) => b.score - a.score).slice(0, 3);
      context = topChunks.map(c => c.text).join("\n");
    }

    const inputMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    if (context) {
      inputMessages.push({ role: "system", content: `Información relevante de documentos:\n${context}` });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: inputMessages,
      }),
    });

    const data = await response.json();
    const text = data?.output?.[0]?.content?.[0]?.text || "No se recibió respuesta.";
    res.json({ text });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Servidor activo en http://localhost:3000"));
