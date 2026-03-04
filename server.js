const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

/* ===============================
   📦 CONFIGURACIÓN
=============================== */
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const FETCH_TIMEOUT = 30000; // 30 segundos

// Cache de URLs
const urlCache = new Map();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  message: { error: "Demasiadas peticiones, intenta más tarde" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

/* ===============================
   🎵 INICIALIZACIÓN
=============================== */
async function initYT() {
  try {
    yt = await Innertube.create({
      client_type: "WEB_REMIX"
    });
    console.log("✅ YouTube Music inicializado 🎵");
    
    // Limpiar cache cada 24 horas
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of urlCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          urlCache.delete(key);
        }
      }
      console.log(`🗑️ Cache limpiado: ${urlCache.size} elementos restantes`);
    }, CACHE_TTL);
    
  } catch (err) {
    console.error("❌ Error inicializando Innertube:", err.message);
    process.exit(1);
  }
}

/* ===============================
   🔐 MIDDLEWARES
=============================== */
function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({ error: "YT no inicializado" });
  }
  next();
}

function validateVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/* ===============================
   🔎 SEARCH - CANCIONES
=============================== */
app.get("/search", requireYT, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    console.log(`🔍 Buscando: "${q}"`);
    const search = await yt.music.search(q, { type: "song" });
    const section = search.contents?.find(s => Array.isArray(s?.contents));

    if (!section) return res.json([]);

    const songs = section.contents
      .filter(item => item?.videoId || item?.id)
      .slice(0, 10)
      .map(item => ({
        id: item.videoId || item.id,
        title: item.name || item.title || "Sin título",
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        duration: item.duration?.text || null,
        thumbnail: getBestThumbnail(item.thumbnails)?.url
      }));

    console.log(`✅ Search completado en ${Date.now() - startTime}ms`);
    res.json(songs);

  } catch (err) {
    console.error("❌ Search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

function getBestThumbnail(thumbnails = []) {
  return thumbnails.reduce((best, thumb) => {
    const currentSize = (thumb.width || 0) * (thumb.height || 0);
    const bestSize = (best?.width || 0) * (best?.height || 0);
    return currentSize > bestSize ? thumb : best;
  }, null);
}

/* ===============================
   🎧 STREAM PROXY
=============================== */
app.get("/stream/:id", requireYT, async (req, res) => {
  const videoId = req.params.id;
  const startTime = Date.now();

  // Validar ID
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
    const info = await yt.getBasicInfo(videoId);
    
    if (!info || !info.streaming_data) {
      throw new Error("No se encontraron datos de streaming");
    }

    // 3. Filtrar audio
    const formats = [
      ...(info.streaming_data?.adaptive_formats || []),
      ...(info.streaming_data?.formats || [])
    ];

    const audio = formats
      .filter(f => f.mime_type?.includes("audio"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audio) {
      throw new Error("No se encontró formato de audio disponible");
    }

    console.log(`🎧 Audio encontrado: ${audio.mime_type} - ${audio.bitrate}bps`);

    // 4. Manejar signatureCipher
    let finalUrl = audio.url;
    if (!finalUrl && audio.signatureCipher) {
      finalUrl = parseCipher(audio.signatureCipher);
    }

    if (!finalUrl) {
      throw new Error("No se pudo obtener la URL del audio");
    }

    // 5. Guardar en cache
    urlCache.set(videoId, {
      url: finalUrl,
      mime: audio.mime_type,
      timestamp: Date.now()
    });

    console.log(`🔗 URL obtenida en ${Date.now() - startTime}ms`);

    // 6. Iniciar streaming
    await streamAudio(res, finalUrl, audio.mime_type);

  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ Stream error (${duration}ms):`, {
      videoId,
      error: err.message,
      stack: err.stack
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

function parseCipher(cipher) {
  const params = new URLSearchParams(cipher);
  const url = params.get("url");
  const sp = params.get("sp");
  const sig = params.get("sig");
  return url && sp && sig ? `${url}&${sp}=${sig}` : null;
}

async function streamAudio(res, url, mimeType) {
  try {
    // 1. Manejar Range Requests (Seeking)
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

    // 2. Headers de seguridad
    res.setHeader("Content-Type", mimeType || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // 3. Fetch con timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

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

    // 4. Manejo de errores en el stream
    response.body.on("error", (err) => {
      console.error("❌ Error en el stream:", err.message);
      res.destroy();
    });

    // 5. Pipe del stream
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
    ytInitialized: !!yt,
    cacheSize: urlCache.size,
    uptime: process.uptime()
  });
});

/* ===============================
   📊 METRICS
=============================== */
app.get("/metrics", (req, res) => {
  res.json({
    cacheSize: urlCache.size,
    cacheTTL: CACHE_TTL,
    fetchTimeout: FETCH_TIMEOUT,
    ytInitialized: !!yt
  });
});

/* ===============================
   🚀 START
=============================== */
(async () => {
  try {
    await initYT();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
      console.log(`📍 Search: http://localhost:${PORT}/search?q=example`);
      console.log(`📍 Stream: http://localhost:${PORT}/stream/:videoId`);
    });
  } catch (err) {
    console.error("❌ Error inicializando servidor:", err);
    process.exit(1);
  }
})();
