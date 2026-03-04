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
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const cached = searchCache.get(q);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.json(cached.data);
    }

    if (!yt || !ytInitialized) {
      return res.status(503).json({ error: "Servicio de YouTube no disponible aún, reintenta en unos segundos" });
    }

    let searchResults;
    try {
      // Preferimos el endpoint Music específico
      searchResults = await yt.music.search(q, {
        filter: "songs",
        limit: 15
      });
    } catch (musicErr) {
      console.warn("Búsqueda Music falló:", musicErr.message);
      // Fallback a búsqueda general con contexto Music
      searchResults = await yt.search(q, { client: "YTMUSIC" });
    }

    let songs = [];

    // Estructura típica en v16.x (puede variar un poco → adapta si ves logs)
    if (searchResults?.songs && Array.isArray(searchResults.songs)) {
      songs = searchResults.songs.slice(0, 10).map(item => mapSong(item));
    } else if (searchResults?.results) {
      songs = searchResults.results
        .filter(item => item.type === "song" || item.videoId)
        .slice(0, 10)
        .map(item => mapSong(item));
    }

    function mapSong(item) {
      return {
        id: item.id || item.videoId || "unknown",
        title: item.title?.text || item.title || "Sin título",
        artist: item.artists?.[0]?.name || item.author?.name || item.channel?.name || "Desconocido",
        duration: item.duration?.text || item.duration?.simpleText || item.length || "0:00",
        thumbnail: item.thumbnail?.[0]?.url || item.thumbnails?.[0]?.url || null
      };
    }

    if (songs.length === 0) {
      console.log(`No resultados para "${q}"`);
    }

    searchCache.set(q, { data: songs, time: Date.now() });
    res.json(songs);
  } catch (err) {
    console.error("Error en /search:", err.message);
    res.status(500).json({ error: "Error al buscar", details: err.message });
  }
});

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
