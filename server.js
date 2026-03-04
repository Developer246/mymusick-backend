const express = require("express");
const cors = require("cors");
const ytdl = require("ytdl-core");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

/* ===============================
   📦 CONFIGURACIÓN
=============================== */
const CACHE_TTL = 24 * 60 * 60 * 1000;
const urlCache = new Map();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Demasiadas peticiones, intenta más tarde" }
});

app.use(limiter);

/* ===============================
   🔐 MIDDLEWARES
=============================== */
function validateVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/* ===============================
   🔎 SEARCH - CANCIONES
=============================== */
app.get("/search", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    console.log(`🔍 Buscando: "${q}"`);
    const search = await ytdl.search(q, { filter: "music_songs" });
    const songs = search
      .slice(0, 10)
      .map(item => ({
        id: ytdl.getVideoID(item.url),
        title: item.title,
        artist: item.author.name,
        duration: item.duration,
        thumbnail: item.thumbnails?.[0]?.url || null
      }));

    console.log(`✅ Search completado en ${Date.now() - startTime}ms`);
    res.json(songs);

  } catch (err) {
    console.error("❌ Search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

/* ===============================
   🎧 STREAM PROXY
=============================== */
app.get("/stream/:id", async (req, res) => {
  const videoId = req.params.id;
  const startTime = Date.now();

  if (!validateVideoId(videoId)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    console.log(`🎵 Iniciando stream para video: ${videoId}`);

    // 1. Verificar cache
    const cached = urlCache.get(videoId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`📦 Usando URL en cache para ${videoId}`);
      return streamAudio(res, cached.url, cached.mime);
    }

    // 2. Obtener info del video
    console.log(`📡 Obteniendo info de YouTube...`);
    const info = await ytdl.getInfo(videoId);

    // 3. Filtrar audio
    const formats = info.formats.filter(f => f.mimeType?.includes("audio"));
    const audio = formats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audio) {
      throw new Error("No se encontró formato de audio disponible");
    }

    console.log(`🎧 Audio encontrado: ${audio.mimeType} - ${audio.bitrate}bps`);

    // 4. Guardar en cache
    urlCache.set(videoId, {
      url: audio.url,
      mime: audio.mimeType,
      timestamp: Date.now()
    });

    console.log(`🔗 URL obtenida en ${Date.now() - startTime}ms`);

    // 5. Iniciar streaming
    await streamAudio(res, audio.url, audio.mimeType);

  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ Stream error (${duration}ms):`, {
      videoId,
      error: err.message
    });
    
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error procesando stream",
        message: err.message,
        videoId: videoId
      });
    } else {
      res.destroy();
    }
  }
});

async function streamAudio(res, url, mimeType) {
  try {
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Infinity;
      const size = end - start + 1;

      res.setHeader("Content-Range", `bytes ${start}-${end}/Infinity`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", size);
      res.status(206);
    } else {
      res.setHeader("Content-Length", "0");
    }

    res.setHeader("Content-Type", mimeType || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    response.body.on("error", (err) => {
      console.error("❌ Error en el stream:", err.message);
      res.destroy();
    });

    response.body.pipe(res);

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Error al conectar con el servidor de audio" });
    } else {
      res.destroy();
    }
  }
}

/* ===============================
   🏥 HEALTH CHECK
=============================== */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    cacheSize: urlCache.size,
    uptime: process.uptime()
  });
});

/* ===============================
   🚀 START
=============================== */
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`📍 Search: http://localhost:${PORT}/search?q=example`);
  console.log(`📍 Stream: http://localhost:${PORT}/stream/:videoId`);
});
