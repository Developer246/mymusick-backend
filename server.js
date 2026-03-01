const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

// Inicializa YouTube Music
async function initYT() {
  yt = await Innertube.create({ client_type: "ANDROID_MUSIC" });
  console.log("YouTube Music inicializado 🎵");
}

// Middleware para asegurar que yt esté listo
function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({ error: "YouTube Music no está inicializado" });
  }
  next();
}

// Endpoint de búsqueda
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents?.find(s => Array.isArray(s?.contents));
    if (!section) return res.json([]);

    const songs = section.contents
      .filter(i => i?.id)
      .slice(0, 10)
      .map(i => {
        // Selecciona la miniatura de mayor resolución disponible
        const hdThumb = i.thumbnails?.reduce((best, thumb) => {
          const currentSize = parseInt(thumb.width || 0) * parseInt(thumb.height || 0);
          const bestSize = parseInt(best?.width || 0) * parseInt(best?.height || 0);
          return currentSize > bestSize ? thumb : best;
        }, null);

        return {
          id: i.id,
          title: i.name || i.title || "Sin título",
          artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
          album: i.album?.name || null,
          duration: i.duration?.text || null,
          thumbnail: hdThumb?.url?.replace(/w\d+-h\d+/, "w1080-h1080") || null
        };
      });

    res.json(songs);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

// Endpoint de audio con streaming directo
app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const id = req.params.id;
    const info = await yt.getInfo(id);

    const stream = await info.download({
      type: "audio",
      quality: "best"
    });

    const mime = stream.mime_type || "audio/webm";
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");

    stream.pipe(res);

  } catch (err) {
    console.error("🔥 AUDIO ERROR REAL:", err);
    res.status(500).json({
      error: "No se pudo reproducir el audio",
      detail: err.message
    });
  }
});

// Arranca el servidor
app.listen(PORT, async () => {
  await initYT();
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
