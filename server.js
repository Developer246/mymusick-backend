const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { Innertube, UniversalCache } = require("youtubei.js");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/* ===============================
   RATE LIMIT (ajustado para producción en Render)
=============================== */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 180,                 // subido un poco, pero monitorea abuso
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas peticiones, espera un momento" }
  })
);

/* ===============================
   CLIENT YouTube (youtubei.js v16.x - 2026)
=============================== */
let yt = null;
let ytInitialized = false;

async function initYT() {
  if (ytInitialized) return;

  try {
    yt = await Innertube.create({
      // Evitamos client_type string (cambió/deprecado en versiones recientes)
      // retrieve_player: false,     // ahorra requests si no necesitas player
      cache: new UniversalCache(false), // false = sin disco, más rápido en Render
      generate_session_locally: true    // ayuda con algunos rate-limits/bloqueos
    });

    ytInitialized = true;
    console.log("🎵 YouTube client inicializado correctamente");
  } catch (err) {
    console.error("Error inicializando youtubei.js:", err.message);
    setTimeout(initYT, 12000); // retry en 12 segundos
  }
}

initYT(); // Inicia al levantar el server

/* ===============================
   CACHE SIMPLE (para búsquedas)
=============================== */
const searchCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

/* ===============================
   🔎 SEARCH (YouTube Music style)
=============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) {
      return res.json([]);
    }

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents?.find(section =>
      Array.isArray(section?.contents)
    );

    if (!section) {
      return res.json([]);
    }

    const songs = section.contents
      .filter(item => item?.videoId || item?.id)
      .slice(0, 10)
      .map(item => {
        const hdThumb = getBestThumbnail(item.thumbnails);

        return {
          id: item.videoId || item.id,
          title: item.name || item.title || "Sin título",
          artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
          album: item.album?.name || null,
          duration: item.duration?.text || null,
          thumbnail: hdThumb
            ? hdThumb.url.replace(/w\\d+-h\\d+/, "w1080-h1080")
            : null
        };
      });

    res.json(songs);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      error: "Error buscando canciones",
      message: err.message
    });
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
   🎧 STREAM AUDIO (solo youtubei.js)
=============================== */
function validateVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

app.get("/stream/:id", async (req, res) => {
  const videoId = req.params.id;

  if (!validateVideoId(videoId)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  if (!yt || !ytInitialized) {
    return res.status(503).json({ error: "Servicio no listo" });
  }

  try {
    // Obtenemos info básica + formatos (contexto Music ayuda con disponibilidad)
    const info = await yt.getBasicInfo(videoId, { client: "YTMUSIC" });

    const format = info.chooseFormat({
      type: "audio",
      quality: "best"          // o "highest"
      // Puedes agregar: bitrate: "high" si quieres filtrar más
    });

    if (!format) {
      return res.status(404).json({ error: "No se encontró formato de audio disponible" });
    }

    res.set({
      "Content-Type": format.mime_type || "audio/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache, no-store, private",
      "Content-Disposition": "inline"
    });

    const stream = await format.createStream();

    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("Error en stream:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error durante el streaming" });
      }
      res.end();
    });

  } catch (err) {
    const status = err.message?.includes("403") || err.message?.includes("unavailable") ? 403 : 500;
    console.error("Stream fatal:", err.message);
    res.status(status).json({
      error: "No se pudo reproducir el audio",
      details: err.message.slice(0, 150)
    });
  }
});

/* ===============================
   HEALTH CHECK
=============================== */
app.get("/health", (req, res) => {
  res.json({
    status: ytInitialized ? "ok" : "initializing",
    uptime: process.uptime(),
    ytReady: ytInitialized,
    timestamp: new Date().toISOString(),
    version: "2.1.0"
  });
});

/* ===============================
   404 para rutas no encontradas
=============================== */
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

/* ===============================
   START SERVER
=============================== */
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
