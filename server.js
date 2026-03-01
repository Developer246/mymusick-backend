const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

// Inicializa YouTube Music con cookies
async function initYT() {
  // Lee cookies desde un archivo cookies.json
  // cookies.json debe tener: { "cookie": "VISITOR_INFO1_LIVE=...; YSC=...; PREF=...; AUTH=..." }
  const cookies = JSON.parse(fs.readFileSync("./cookies.json", "utf8"));

  yt = await Innertube.create({
    client_type: "ANDROID_MUSIC", // más confiable para streams
    cookie: cookies.cookie
  });

  console.log("YouTube Music inicializado con cookies 🎵");
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
      .filter(i => i?.videoId || i?.id)
      .slice(0, 10)
      .map(i => {
        // Selecciona la miniatura más grande disponible
        const hdThumb = i.thumbnails?.reduce((best, thumb) => {
          const currentSize = (thumb.width || 0) * (thumb.height || 0);
          const bestSize = (best?.width || 0) * (best?.height || 0);
          return currentSize > bestSize ? thumb : best;
        }, null);

        return {
          id: i.videoId || i.id, // usar videoId si existe
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

    if (info.playability_status?.status === "LOGIN_REQUIRED") {
      return res.status(403).json({ error: "Este contenido requiere inicio de sesión en YouTube Music" });
    }

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

