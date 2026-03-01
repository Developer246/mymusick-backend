const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

// Inicializa YouTube Music
async function initYT() {
  yt = await Innertube.create({ client_type: "WEB_REMIX" });
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

    // Busca la sección que contiene canciones
    const section = search.contents?.find(s => Array.isArray(s?.contents));
    if (!section) return res.json([]);

    const songs = section.contents
      .filter(i => i?.id)
      .slice(0, 10)
      .map(i => ({
        id: i.id,
        title: i.name || i.title || "Sin título",
        artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: i.album?.name || null,
        duration: i.duration?.text || null,
        thumbnail: i.thumbnails?.at(-1)?.url?.replace(/w\\d+-h\\d+/, "w544-h544")
      }));

    res.json(songs);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

// Endpoint de audio
app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const id = req.params.id;
    const info = await yt.music.getInfo(id);

  app.get("/audio/:id", requireYT, async (req, res) => {
  try {
    const id = req.params.id;
    const info = await yt.music.getInfo(id);

    // Busca primero en adaptive_formats
    const audioFormat = info.streaming_data?.adaptive_formats
      ?.filter(f => f.mime_type.includes("audio"))
      ?.sort((a, b) => b.bitrate - a.bitrate)[0];

    if (!audioFormat) {
      return res.status(404).json({ error: "No se encontró audio" });
    }

    res.json({ url: audioFormat.url });
  } catch (error) {
    console.error("Audio error:", error.message);
    res.status(500).json({ error: "Error obteniendo audio" });
  }
});


// Arranca el servidor
app.listen(PORT, async () => {
  await initYT();
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

