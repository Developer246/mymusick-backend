const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { Innertube, UniversalCache, ClientType } = require("youtubei.js"); // ← importante: importar ClientType
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/* ===============================
   🔐 RATE LIMIT (puedes subir un poco si usas proxy/CDN)
=============================== */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 200,                 // ← subí un poco, pero monitorea
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ===============================
   🧠 YT CLIENT (más robusto en 2026)
=============================== */
let yt;
async function initYT() {
  try {
    yt = await Innertube.create({
      // client_type ya no es string en versiones nuevas
      // Puedes omitirlo (default WEB) o usar:
      // retrieve_player: true,  // útil si luego quieres lyrics, related, etc.
      cache: new UniversalCache(false), // o true si quieres caché en disco
      // generate_session_locally: true, // a veces ayuda con rate-limits
    });
    console.log("🎵 YouTube client inicializado OK");
  } catch (err) {
    console.error("Error al iniciar youtubei.js:", err);
    setTimeout(initYT, 10000); // retry automático después de 10s
  }
}

initYT();

/* ===============================
   🧠 CACHE SIMPLE (mejor usar LRU si crece)
=============================== */
const searchCache = new Map();
const CACHE_TTL = 8 * 60 * 1000; // subí a 8 min

/* ===============================
   🔎 SEARCH (estilo YouTube Music 2026)
=============================== */
app.get("/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);

  const cached = searchCache.get(q);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return res.json(cached.data);
  }

  if (!yt) return res.status(503).json({ error: "Cliente YT no listo" });

  try {
    // Forma moderna (2025–2026)
    const search = await yt.search(q, {
      // filter: "songs",          // ← antes era "type: song"
      // limit: 10,
      // client: "YTMUSIC"         // algunos lo requieren explícitamente
    });

    const songs = search.songs?.slice(0, 10).map((item) => ({
      id: item.id,
      title: item.title?.text || item.title || "Sin título",
      artist: item.author?.name || item.artists?.[0]?.name || "Desconocido",
      duration: item.duration?.text || item.length || "0:00",
      thumbnail: item.thumbnails?.[0]?.url || item.thumbnail?.url || null,
    })) || [];

    searchCache.set(q, { data: songs, time: Date.now() });
    res.json(songs);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Error en búsqueda", details: err.message });
  }
});

/* ===============================
   🎧 STREAM AUDIO → ahora usando youtubei.js (MUCHO más estable)
=============================== */
function validateVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

app.get("/stream/:id", async (req, res) => {
  const videoId = req.params.id;
  if (!validateVideoId(videoId)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  if (!yt) return res.status(503).json({ error: "Cliente no listo" });

  try {
    const info = await yt.getBasicInfo(videoId);
    const format = info.chooseFormat({
      type: "audio",           // o "audioonly"
      quality: "best",         // o "highest"
    });

    if (!format) {
      return res.status(404).json({ error: "No se encontró formato de audio" });
    }

    res.setHeader("Content-Type", format.mime_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache, no-store");

    // Streaming directo desde youtubei.js
    const stream = await format.createStream();
    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("Stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Error en stream" });
      else res.destroy();
    });
  } catch (err) {
    console.error("Stream fatal:", err.message);
    const code = err.message.includes("403") ? 403 : 500;
    res.status(code).json({ error: "No se pudo obtener el stream", details: err.message });
  }
});

/* ===============================
   🏥 HEALTH CHECK + YT status
=============================== */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    ytReady: !!yt,
    timestamp: new Date().toISOString(),
  });
});

/* ===============================
   🚀 START
=============================== */
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});
