import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import mammoth from "mammoth";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SISTEMA = process.env.SYSTEM_PROMPT || "Eres un asistente amable y claro.";

// --- Embeddings de documentos ---
let baseVectores = [];
const ARCHIVO_VECTORES = "./vectorStore.json";

function similitudCoseno(a, b) {
  const producto = a.reduce((suma, val, i) => suma + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((suma, val) => suma + val * val, 0));
  const magB = Math.sqrt(b.reduce((suma, val) => suma + val * val, 0));
  if (magA === 0 || magB === 0) return 0;
  return producto / (magA * magB);
}

async function cargarDocumentos() {
  if (fs.existsSync(ARCHIVO_VECTORES)) {
    try {
      baseVectores = JSON.parse(fs.readFileSync(ARCHIVO_VECTORES, "utf-8"));
      if (Array.isArray(baseVectores) && baseVectores.length > 0) return;
    } catch {
      baseVectores = [];
    }
  }

  if (!fs.existsSync("./docs")) return;

  const archivos = fs.readdirSync("./docs").filter(f => f.toLowerCase().endsWith(".docx"));
  for (const archivo of archivos) {
    const buffer = fs.readFileSync(`./docs/${archivo}`);
    const resultado = await mammoth.extractRawText({ buffer });
    const texto = resultado.value || "";

    const TAMANO_FRAGMENTO = 500;
    for (let i = 0; i < texto.length; i += TAMANO_FRAGMENTO) {
      const fragmento = texto.slice(i, i + TAMANO_FRAGMENTO);
      if (!fragmento.trim()) continue;
      const emb = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: fragmento,
      });
      baseVectores.push({
        id: `${archivo}-${i}`,
        texto: fragmento,
        embedding: emb.data[0].embedding,
        fuente: archivo,
      });
    }
  }

  if (baseVectores.length > 0) {
    fs.writeFileSync(ARCHIVO_VECTORES, JSON.stringify(baseVectores));
  }
}
await cargarDocumentos();

const PALABRAS_DOCUMENTOS = [
  "arquitectura", "gótica",
  "veterinaria", "vet", "animales",
  "league of legends", "lol", "tft", "builds", "campeones"
];

function esConversacionDeDocumento(pregunta) {
  const texto = (pregunta || "").toLowerCase();
  return PALABRAS_DOCUMENTOS.some(p => texto.includes(p));
}

const funciones = [
  { nombre: "saluda", palabras: ["saludame", "hola"], ejecutar: () => "Hola Pablo, encantado de saludarte." },
  { nombre: "tiempo", palabras: ["tiempo", "clima"], ejecutar: () => "El tiempo en Badajoz es soleado con 25°C." }
];

function detectarFuncion(mensaje) {
  const texto = (mensaje || "").toLowerCase();
  return funciones.find(fn => fn.palabras.some(p => texto.includes(p)));
}

// --- Chat endpoint (streaming SSE) ---
app.post("/api/chat", async (req, res) => {
  const { messages = [] } = req.body;
  const ultimoMensaje = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

  try {
    const fn = detectarFuncion(ultimoMensaje);
    if (fn) return res.json({ text: fn.ejecutar() });

    let contexto = "";
    if (esConversacionDeDocumento(ultimoMensaje) && baseVectores.length > 0) {
      const qEmbedding = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: ultimoMensaje,
      });
      const queryVector = qEmbedding.data[0].embedding;
      const puntuados = baseVectores.map(c => ({
        ...c,
        score: similitudCoseno(queryVector, c.embedding),
      }));
      const mejores = puntuados.sort((a, b) => b.score - a.score).slice(0, 3);
      contexto = mejores.map(c => c.texto).join("\n");
    }

    const mensajesEntrada = [
      { role: "system", content: SISTEMA },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];
    if (contexto) mensajesEntrada.push({ role: "system", content: `Información de documentos:\n${contexto}` });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders && res.flushHeaders();

    const stream = await client.responses.stream({
      model: "gpt-4o-mini",
      input: mensajesEntrada
    });

    for await (const evento of stream) {
      if (evento.type === "response.output_text.delta" || evento.type === "response.refusal.delta") {
        const texto = String(evento.delta || "").replace(/\r/g, "");
        if (!texto) continue;
        const lineas = texto.split("\n");
        for (const ln of lineas) res.write(`data: ${ln}\n\n`);
      } else if (evento.type === "response.error") {
        const errMsg = evento.error?.message || "Error interno en el stream";
        res.write(`data: ${errMsg}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else {
      try { res.write(`data: Error: ${err.message}\n\n`); res.write("data: [DONE]\n\n"); res.end(); } catch {}
    }
  }
});

// --- Audio endpoint ---
const upload = multer({ dest: path.join(__dirname, "audios/") });

app.post("/api/voz", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    console.log("No se recibió archivo de audio");
    return res.status(400).json({ error: "Archivo de audio requerido" });
  }

  try {
    const ext = path.extname(req.file.originalname) || ".webm";
    const tempPath = req.file.path + ext;
    fs.renameSync(req.file.path, tempPath);

    console.log("Archivo de audio guardado:", tempPath);

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "gpt-4o-mini-transcribe",
    });

    console.log("Transcripción:", transcription.text);

    res.json({ text: transcription.text });

    fs.unlinkSync(tempPath);
    console.log("Archivo temporal eliminado");
  } catch (err) {
    console.error("Error procesando audio:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Servidor ---
app.listen(3000, () => console.log("Servidor activo en http://localhost:3000"));
