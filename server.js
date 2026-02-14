const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

// Inicializa YouTube Music
async function initYouTube() {
  yt = await Innertube.create({ client_type: "ANDROID" });
  console.log("🎵 YouTube Music listo");
}

// Endpoint de búsqueda
app.get("/search", async (req, res) => {
  try {
    if (!yt) {
      return res.status(503).json({ error: "YouTube aún no está listo" });
    }

    const q = req.query.q?.toString().trim();
    if (!q) {
      return res.status(400).json({ error: "Falta el parámetro ?q=" });
    }

    const result = await yt.music.search(q, { type: "song" });

    // Buscar la sección de canciones correcta
    const section = result.contents?.find(c => c.type === "musicShelfRenderer");
    const items = section?.contents || [];

    const canciones = items.map(song => ({
      id: song.videoId || song.playlistId || "desconocido",
      titulo: song.title?.runs?.[0]?.text || "Desconocido",
      artista: song.longBylineText?.runs?.map(a => a.text).join(", ") || "Desconocido",
      duracion: song.thumbnailOverlays?.[0]?.text?.simpleText || "0:00",
      thumbnail: song.thumbnail?.thumbnails?.[0]?.url || null
    }));

    if (!canciones.length) {
      return res.status(404).json({ error: "No se encontraron canciones para esa búsqueda" });
    }

    res.json(canciones);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en la búsqueda" });
  }
});

// Puerto configurable para Render o local
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initYouTube();
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});




