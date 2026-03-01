const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let yt = null;

/* =======================================================
   INICIALIZACIÓN YOUTUBE MUSIC
======================================================= */

async function initYT() {
  const cookie = process.env.YTM_COOKIE;

  yt = await Innertube.create({
    client_type: "ANDROID_MUSIC",
    cookie
  });

  console.log("YouTube Music inicializado correctamente 🎵");
}

/* =======================================================
   MIDDLEWARE SEGURIDAD
======================================================= */

function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({
      error: "YouTube Music no está listo"
    });
  }
  next();
}

/* =======================================================
   HEALTH CHECK (IMPORTANTE PARA RENDER)
======================================================= */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "MYMUSICK Backend 🎧"
  });
});

/* =======================================================
   BUSCADOR DE CANCIONES
======================================================= */

app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents?.find(s => Array.isArray(s?.contents));
    if (!section) return res.json([]);

    const songs = section.contents
      .filter(i => i?.videoId)
      .slice(0, 10)
      .map(i => {
        const bestThumb = i.thumbnails?.reduce((best, thumb) => {
          const size = (thumb.width || 0) * (thumb.height || 0);
          const bestSize = (best?.width || 0) * (best?.height || 0);
          return size > bestSize ? thumb : best;
        }, null);

        return {
          id: i.videoId,
          title: (i.name || i.title || "Sin título")
            .replace(/\(.*?\)/g, "")
            .replace(/official|video/gi, "")
            .trim(),
          artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
          album: i.album?.name || null,
          duration: i.duration?.text || null,
          thumbnail: bestThumb?.url || null
        };
      });

    res.json(songs);

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({
      error: "Error buscando canciones"
    });
  }
});

/* =======================================================
   STREAM DE AUDIO PROFESIONAL
======================================================= */

app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const id = req.params.id;

    const info = await yt.getInfo(id);

    if (info.playability_status?.status === "LOGIN_REQUIRED") {
      return res.status(403).json({
        error: "Contenido requiere login"
      });
    }

    const stream = await info.download({
      type: "audio",
      quality: "best"
    });

    const mime = stream.mime_type || "audio/webm";

    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");

    if (req.headers.range) {
      res.status(206);
    }

    stream.pipe(res);

    // Limpieza si el usuario cierra conexión
    req.on("close", () => {
      stream.destroy();
    });

  } catch (err) {
    console.error("AUDIO ERROR:", err);

    res.status(500).json({
      error: "No se pudo reproducir el audio",
      detail: err.message
    });
  }
});

/* =======================================================
   INICIO SEGURO DEL SERVIDOR
======================================================= */

(async () => {
  try {
    await initYT();

    app.listen(PORT, () => {
      console.log(`Servidor MYMUSICK corriendo en puerto ${PORT} 🚀`);
    });

  } catch (err) {
    console.error("Error inicializando YouTube Music:", err);
    process.exit(1);
  }
})();

