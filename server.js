const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

/* =======================================================
   FETCH COMPATIBLE CON RENDER
======================================================= */

let fetchFn;

if (typeof fetch === "undefined") {
  fetchFn = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
} else {
  fetchFn = fetch;
}

/* =======================================================
   APP CONFIG
======================================================= */

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let yt = null;
const lyricsCache = new Map();

/* =======================================================
   INIT YOUTUBE
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
   SEARCH SONGS
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
   AUDIO STREAM
======================================================= */

const { exec } = require("child_process");

app.get("/audio/:id", async (req, res) => {
  const videoId = req.params.id;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-cache");

  const process = exec(
    `yt-dlp -f bestaudio -o - ${url}`,
    { maxBuffer: 1024 * 1024 * 10 }
  );

  process.stdout.pipe(res);

  process.stderr.on("data", (err) => {
    console.error("yt-dlp error:", err.toString());
  });

  process.on("close", (code) => {
    if (code !== 0) {
      res.end();
    }
  });
});

/* =======================================================
   DOWNLOAD
======================================================= */

app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const info = await yt.getInfo(req.params.id);

    const stream = await info.download({
      type: "audio",
      quality: "best",
      client: "WEB",
      format: "mp4"
    });

    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Accept-Ranges", "bytes");

    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream interrumpido" });
      }
    });

    stream.pipe(res);

  } catch (err) {
    console.error("Audio error FULL:", err);
    res.status(500).json({ error: "No se pudo reproducir el audio" });
  }
});

/* =======================================================
   LYRICS SEARCH (CON CACHE + TIMEOUT)
======================================================= */

app.get("/lyrics/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    let limit = parseInt(req.query.limit, 10);

    if (!q) {
      return res.status(400).json({ error: "Query requerida" });
    }

    if (isNaN(limit) || limit <= 0) {
      limit = 5;
    }

    const cacheKey = `${q}_${limit}`;
    if (lyricsCache.has(cacheKey)) {
      return res.json(lyricsCache.get(cacheKey));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetchFn(
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

    lyricsCache.set(cacheKey, formatted);

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
   GLOBAL ERROR GUARD
======================================================= */

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});
