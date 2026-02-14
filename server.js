const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

async function initYouTube() {
  yt = await Innertube.create({ client_type: "WEB_REMIX" });
  console.log("🎵 YouTube Music listo");
}

app.get("/search", async (req, res) => {
  try {
    if (!yt) {
      return res.status(503).json({ error: "YouTube aún no está listo" });
    }

    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: "Falta el parámetro ?q=" });
    }

    const result = await yt.music.search(q, { type: "song" });

    const canciones = result.contents.map(song => ({
      id: song.id,
      titulo: song.title?.text,
      artista: song.artists?.map(a => a.name).join(", "),
      duracion: song.duration?.text,
      thumbnail: song.thumbnails?.[0]?.url
    }));

    res.json(canciones);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en la búsqueda" });
  }
});

app.listen(3000, async () => {
  await initYouTube();
  console.log("🚀 Servidor corriendo en puerto 3000");
});



