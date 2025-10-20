import express from "express";
import dotenv from "dotenv";
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
const VECTOR_FILE = "./vectorStore.json";

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

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
  return DOCUMENT_KEYWORDS.some(k => qLower.includes(k));
}

const funciones = [
  { name: "saluda", keywords: ["saludame", "hola"], execute: () => "¡Hola Pablo! Encantado de saludarte." },
  { name: "tiempo", keywords: ["tiempo", "clima"], execute: () => "El tiempo en Badajoz es soleado con 25°C." }
];

function detectFunction(message) {
  const msgLower = message.toLowerCase();
  return funciones.find(fn => fn.keywords.some(k => msgLower.includes(k)));
}

app.post("/api/chat", async (req, res) => {
  const { messages = [] } = req.body;
  const ultimoMensaje = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

  try {
    const fn = detectFunction(ultimoMensaje);
    if (fn) {
      return res.json({ text: fn.execute() });
    }

    let context = "";
    if (conversacion(ultimoMensaje)) {
      const qEmbedding = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: ultimoMensaje,
      });
      const queryVector = qEmbedding.data[0].embedding;
      const scored = vectorStore.map(c => ({ ...c, score: cosineSimilarity(queryVector, c.embedding) }));
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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Envío de respuesta en streaming
    const stream = await client.responses.stream({
      model: "gpt-4o-mini",
      input: inputMessages
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        res.write(`data: ${event.delta}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();

  } catch (err) {
    console.error("Error en /api/chat:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Servidor activo en http://localhost:3000"));
