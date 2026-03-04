const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

const { Innertube } = require("youtubei.js");
const ytdl = require("@distube/ytdl-core");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/* ===============================
   🔐 RATE LIMIT
=============================== */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150
  })
);

/* ===============================
   🧠 YT MUSIC CLIENT
=============================== */
let yt;

async function initYT() {
  try {
    yt = await Innertube.create({
      client_type: "WEB_REMIX"
    });
    console.log("🎵 YouTube Music listo");
  } catch (err) {
    console.error("Error iniciando YouTubei:", err.message);
  }
}

initYT();

/* ===============================
   🧠 CACHE SIMPLE
=============================== */
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/* ===============================
   🔎 SEARCH (YT MUSIC STYLE)
=============================== */
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const cached = searchCache.get(q);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.json(cached.data);
    }

    if (!yt) return res.status(503).json({ error: "YT no inicializado" });

    const results = await yt.search(q, { type: "song" });

    const songs = results.results
      .slice(0, 10)
      .map(item => ({
        id: item.id,
        title: item.title?.text || "Sin título",
        artist: item.author?.name || "Desconocido",
        duration: item.duration?.text || "0:00",
        thumbnail: item.thumbnails?.[0]?.url || null
      }));

    searchCache.set(q, { data: songs, time: Date.now() });

    res.json(songs);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

/* ===============================
   🎧 STREAM AUDIO
=============================== */
function validateVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

app.get("/stream/:id", async (req, res) => {
  const videoId = req.params.id;

  if (!validateVideoId(videoId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const info = await ytdl.getInfo(videoId);
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter: "audioonly"
    });

    if (!format) {
      return res.status(404).json({ error: "Formato no encontrado" });
    }

    res.setHeader("Content-Type", format.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");

    const stream = ytdl(videoId, { format });

    stream.on("error", err => {
      console.error("Stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error en el stream" });
      } else {
        res.destroy();
      }
    });

    stream.pipe(res);

  } catch (err) {
    console.error("Stream fatal:", err.message);
    res.status(500).json({ error: "Error procesando stream" });
  }
});

/* ===============================
   🏥 HEALTH CHECK
=============================== */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime()
  });
});

/* ===============================
   🚀 START
=============================== */
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
