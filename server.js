const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { Innertube } = require("youtubei.js");
const ytdlp = require("yt-dlp-exec");

const app = express();
app.use(cors());
app.use(express.json());

let yt = null;
const PORT = process.env.PORT || 3000;

/* =======================================================
   INICIALIZACIÓN SEGURA
======================================================= */

async function initYouTube() {
  try {
    yt = await Innertube.create({
      client_type: "WEB",
      generate_session_locally: true
      // Si usas cookies reales:
      // cookie: fs.readFileSync("cookies.txt", "utf-8")
    });

    console.log("🎵 YouTube inicializado");
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
   HEALTH
======================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    youtube: !!yt,
    uptime: process.uptime()
  });
});

/* =======================================================
   🔍 SEARCH (youtubei.js)
======================================================= */

app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.search(q);

    const videos = search.results
      .filter(v => v.type === "Video")
      .slice(0, 10)
      .map(v => ({
        id: v.id,
        title: v.title,
        artist: v.author?.name || "Desconocido",
        duration: v.duration?.text || null,
        thumbnail: v.thumbnails?.at(-1)?.url
      }));

    res.json(videos);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

/* =======================================================
   🎧 STREAMING (yt-dlp)
======================================================= */

app.get("/audio/:id", async (req, res) => {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${req.params.id}`;

    res.setHeader("Content-Type", "audio/webm");
    res.setHeader("Accept-Ranges", "bytes");

    const process = ytdlp.exec(videoUrl, {
      format: "bestaudio",
      output: "-",
      quiet: true,
      noWarnings: true
    });

    process.stdout.pipe(res);

    process.stderr.on("data", data => {
      console.error("yt-dlp:", data.toString());
    });

    process.on("error", err => {
      console.error("Process error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "No se pudo reproducir el audio" });
      }
    });

  } catch (err) {
    console.error("Audio error:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

/* =======================================================
   ⬇️ DOWNLOAD
======================================================= */

app.get("/download/:id", async (req, res) => {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${req.params.id}`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audio.webm"`
    );
    res.setHeader("Content-Type", "audio/webm");

    const process = ytdlp.exec(videoUrl, {
      format: "bestaudio",
      output: "-"
    });

    process.stdout.pipe(res);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo descargar" });
  }
});

/* =======================================================
   🎤 LYRICS
======================================================= */

app.get("/lyrics/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) {
      return res.status(400).json({ error: "Query requerida" });
    }

    const response = await fetch(
      `https://api-lyrics.simpmusic.org/v1/search?q=${encodeURIComponent(q)}&limit=5`
    );

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
    console.error("Lyrics error:", err);
    res.status(500).json({ error: "Servicio de lyrics no disponible" });
  }
});

/* =======================================================
   START
======================================================= */

async function start() {
  await initYouTube();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor activo en puerto ${PORT}`);
  });
}

start();

/* =======================================================
   ANTI-CRASH
======================================================= */

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});
