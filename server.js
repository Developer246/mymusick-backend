const express = require("express");
const cors = require("cors");
const ytdl = require("ytdl-core");
const ytsr = require("ytsr");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (Frontend)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

/* ===============================
   📦 CONFIGURACIÓN
=============================== */
const CACHE_TTL = 5 * 60 * 1000; 
const urlCache = new Map();
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Demasiadas peticiones, intenta más tarde" }
});

app.use(limiter);

/* ===============================
   🔐 VALIDACIONES
=============================== */
function validateVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/* ===============================
   🔎 SEARCH - CANCIONES
=============================== */
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await ytsr(q, {
      limit: 10,
      filters: ["music_songs"]
    });

    const songs = search.items
      .filter(item => item && item.id)
      .map(item => ({
        id: item.id,
        title: item.title || "Sin título",
        artist: item.author?.name || "Artista desconocido",
        duration: item.duration || "0:00",
        thumbnail: item.thumbnails?.[0]?.url || null
      }));

    res.json(songs);
  } catch (err) {
    console.error("❌ Search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

/* ===============================
   🎧 STREAM PROXY (Optimizado)
=============================== */
app.get("/stream/:id", async (req, res) => {
  const videoId = req.params.id;

  if (!validateVideoId(videoId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    // Usar ytdl stream directo (mejor rendimiento que fetch)
    const info = await ytdl.getInfo(videoId, { lang: "es" });
    const formats = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    
    // Configurar cabeceras para audio
    res.setHeader("Content-Type", formats.mimeType);
    res.setHeader("Cache-Control", "no-cache");
    
    // Iniciar el stream desde YouTube directamente
    ytdl(videoId, { quality: 'highestaudio', filter: 'audioonly' })
      .pipe(res);

  } catch (err) {
    console.error("❌ Stream error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Error en el stream" });
    else res.destroy();
  }
});

/* ===============================
   🏥 HEALTH CHECK
=============================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/* ===============================
   🚀 START
=============================== */
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🎵 Interfaz estilo YT Music cargada.`);
});
