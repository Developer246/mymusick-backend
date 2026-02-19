const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt = null;

/* -------------------- INICIALIZACIÓN SEGURA -------------------- */
async function initYouTube() {
  try {
    yt = await Innertube.create({
      client_type: "WEB-REMIX"
    });
    console.log("YouTube Music inicializado");
  } catch (err) {
    console.error("Error iniciando Innertube:", err);
    throw err;
  }
}

/* -------------------- MIDDLEWARE DE SALUD -------------------- */
function requireYT(req, res, next) {
  if (!yt) return res.sendStatus(503);
  next();
}

/* -------------------- RUTAS -------------------- */

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* 🔍 Buscar canciones */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents.find(s =>
      Array.isArray(s?.contents)
    );
    if (!section) return res.json([]);

    const baseSongs = section.contents
      .filter(i => i?.id)
      .slice(0, 10);

    const songs = section.contents
  .filter(i => i?.id)
  .slice(0, 10)
  .map(i => ({
    id: i.id,
    title: i.name || i.title || "Sin título",
    artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
    album: i.album?.name || null,
    thumbnail: i.thumbnails
      ?.at(-1)
      ?.url
      ?.replace(/w\d+-h\d+/, "w544-h544")
  }));


    res.json(songs);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json([]);
  }
});

/* 🎧 Streaming de audio */
app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const info = await yt.getInfo(req.params.id);
    const stream = await info.download({
  type: "audio",
  format: "webm",
  quality: "medium"
});


    res.setHeader("Content-Type", "audio/webm");
    res.setHeader("Accept-Ranges", "bytes");

    stream.pipe(res);
  } catch (err) {
    console.error("Audio error:", err);
    res.sendStatus(500);
  }
});

/* ⬇️ Descarga de audio */
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
    res.sendStatus(500);
  }
});

app.get("/lyrics/search", async (req, res) => {
  const { q, limit = 5 } = req.query;
  if (!q) return res.status(400).json({ error: "Query requerida" });

  try {
    const url = `https://api-lyrics.simpmusic.org/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Error API lyrics" });
    }

    const data = await response.json();

    res.json(
      data.results.map(song => ({
        title: song.title,
        artists: song.artists,
        id: song.id
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Lyrics service unavailable" });
  }
});

/* -------------------- ARRANQUE CONTROLADO -------------------- */
async function start() {
  try {
    await initYouTube();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log("Servidor activo en puerto", PORT);
    });
  } catch {
    console.error("No se pudo iniciar el servidor");
    process.exit(1);
  }
}

start();

/* -------------------- ANTI-CRASH GLOBAL -------------------- */
process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});

