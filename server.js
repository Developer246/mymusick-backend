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
      client_type: "WEB_REMIX"
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

    const songs = section.contents
      .filter(i => i?.id)
      .slice(0, 10)
      .map(i => ({
        id: i.id,
        title:
          i.flex_columns?.[0]?.text?.runs
            ?.map(r => r.text)
            .join("")
            .trim() || "Sin título",
        artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: i.album?.name || null,
        thumbnail: i.thumbnails?.at(-1)?.url || null
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
      quality: "best"
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

