const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

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
   🔎 SEARCH - SOLO CANCIONES REALES
=============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q);

    // Aplanamos todas las secciones
    const allItems =
      search.contents?.flatMap(section => section.contents || []) || [];

    // Filtramos solo canciones reproducibles
    const songs = allItems
      .filter(item =>
        item.videoId &&           // tiene videoId real
        item.duration?.text       // tiene duración
      )
      .slice(0, 10)
      .map(item => ({
        id: item.videoId,
        title: item.name || item.title || "Sin título",
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        duration: item.duration.text,
        thumbnail: item.thumbnails?.at(-1)?.url || null
      }));

    res.json(songs);

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
    const info = await yt.getInfo(req.params.id);
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

    for await (const chunk of response.body) {
      res.write(chunk);
    }

    res.end();

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
