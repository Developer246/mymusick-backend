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
    client_type: "WEB"
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
            ? hdThumb.url.replace(/w\d+-h\d+/, "w1080-h1080")
            : null
        };
      });

    res.json(songs);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      error: "Error buscando canciones"
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

    // 🔥 CLAVE: usar pipe correctamente
    response.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        }
      })
    );

  } catch (err) {
    console.error("Stream error REAL:", err);
    res.status(500).json({ error: err.message });
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
