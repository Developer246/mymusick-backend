const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");
const fetch = require("node-fetch");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

/* ===============================
   Inicialización
=============================== */
async function initYT() {
  yt = await Innertube.create({
    client_type: "ANDROID_MUSIC"
  });

  console.log("YouTube Music inicializado 🎵");
}

/* ===============================
   Middleware
=============================== */
function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({ error: "YT no inicializado" });
  }
  next();
}

/* ===============================
   🔎 SEARCH - SOLO SONG
=============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const results = (search.contents || [])
      .filter(i => i.id && i.duration?.text)
      .slice(0, 10)
      .map(i => ({
        id: i.id,
        title: i.name || i.title || "Sin título",
        artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
        duration: i.duration.text,
        thumbnail: i.thumbnails?.at(-1)?.url || null
      }));

    res.json(results);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error en búsqueda" });
  }
});

/* ===============================
   🎧 STREAM PROXY
=============================== */
app.get("/stream/:id", requireYT, async (req, res) => {
  try {
    const videoId = req.params.id;

    const info = await yt.getInfo(videoId);

    const formats = info.streaming_data?.adaptive_formats || [];

    const audio = formats
      .filter(f => f.mime_type?.includes("audio"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audio?.url) {
      return res.status(404).json({ error: "Audio no disponible" });
    }

    const response = await fetch(audio.url);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    response.body.pipe(res);

  } catch (err) {
    console.error("Stream error:", err);
    res.status(500).json({ error: "Error obteniendo audio" });
  }
});

/* ===============================
   🚀 START
=============================== */
(async () => {
  try {
    await initYT();
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
    });
  } catch (err) {
    console.error("Error inicializando YT:", err);
    process.exit(1);
  }
})();
