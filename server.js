const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());
app.use(express.json());

/* =======================================================
   VARIABLES GLOBALES
======================================================= */

let yt = null;
const PORT = process.env.PORT || 3000;

/* =======================================================
   INICIALIZACIÓN SEGURA DE YOUTUBE
======================================================= */

async function initYouTube() {
  try {
    yt = await Innertube.create({
      client_type: "WEB_REMIX"
    });

    console.log("🎵 YouTube Music listo");
  } catch (err) {
    console.error("❌ Error iniciando YouTube:", err);
    process.exit(1);
  }
}

/* =======================================================
   MIDDLEWARE
======================================================= */

function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({ error: "YouTube no inicializado" });
  }
  next();
}

/* =======================================================
   RUTA DE SALUD
======================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    youtube: !!yt,
    uptime: process.uptime()
  });
});

/* =======================================================
   🔍 BUSCAR CANCIONES
======================================================= */

app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents?.find(s =>
      Array.isArray(s?.contents)
    );

    if (!section) return res.json([]);

    const songs = section.contents
      .filter(i => i?.id)
      .slice(0, 10)
      .map(i => ({
        id: i.id,
        title: i.name || i.title || "Sin título",
        artist:
          i.artists?.map(a => a.name).join(", ") ||
          "Desconocido",
        album: i.album?.name || null,
        duration: i.duration?.text || null,
        thumbnail: i.thumbnails
          ?.at(-1)
          ?.url
          ?.replace(/w\d+-h\d+/, "w544-h544")
      }));

    res.json(songs);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

/* =======================================================
   🎧 STREAMING CON SOPORTE RANGE (IMPORTANTE)
======================================================= */
app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const info = await yt.music.getInfo(req.params.id);

    if (!info?.streaming_data?.adaptive_formats) {
      return res.status(500).json({
        error: "Streaming data no disponible"
      });
    }

    const audioFormats = info.streaming_data.adaptive_formats
      .filter(f =>
        f.mime_type?.includes("audio") &&
        f.url
      );

    if (!audioFormats.length) {
      return res.status(404).json({
        error: "No hay audio disponible"
      });
    }

    const best = audioFormats.sort((a, b) =>
      (b.bitrate || 0) - (a.bitrate || 0)
    )[0];

    res.setHeader("Content-Type", best.mime_type.split(";")[0]);
    res.setHeader("Accept-Ranges", "bytes");

    const stream = await yt.download({
      url: best.url
    });

    stream.pipe(res);

  } catch (err) {
    console.error("🔥 AUDIO ERROR:", err);

    res.status(500).json({
      error: "No se pudo reproducir el audio",
      detail: err.message
    });
  }
});

/* =======================================================
   ⬇️ DESCARGA
======================================================= */

app.get("/download/:id", requireYT, async (req, res) => {
  try {
    const info = await yt.getInfo(req.params.id);

    const title = (info.basic_info?.title || "audio")
      .replace(/[^\w\s-]/g, "")
      .trim();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${title}.webm"`
    );

    res.setHeader("Content-Type", "audio/webm");

    const stream = await info.download({
      type: "audio",
      quality: "best"
    });

    stream.pipe(res);

  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "No se pudo descargar el audio" });
  }
});

/* =======================================================
   🎤 LYRICS CON TIMEOUT SEGURO
======================================================= */

app.get("/lyrics/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    let limit = parseInt(req.query.limit, 10) || 5;

    if (!q) {
      return res.status(400).json({ error: "Query requerida" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `https://api-lyrics.simpmusic.org/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error API lyrics"
      });
    }

    const data = await response.json();

    const formatted = (data.results || []).map(song => ({
      id: song.id,
      title: song.title || "Sin título",
      artists: Array.isArray(song.artists)
        ? song.artists.join(", ")
        : "Desconocido"
    }));

    res.json(formatted);

  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Lyrics timeout" });
    }

    console.error("Lyrics error:", err);
    res.status(500).json({ error: "Servicio de lyrics no disponible" });
  }
});

/* =======================================================
   INICIO DEL SERVIDOR
======================================================= */

async function start() {
  await initYouTube();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor activo en puerto ${PORT}`);
  });
}

start();

/* =======================================================
   ANTI-CRASH GLOBAL
======================================================= */

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});
