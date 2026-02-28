const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

async function initYT() {
  yt = await Innertube.create({
    client_type: "WEB_REMIX"
  });
  console.log("YouTube Music inicializado 🎵");
}

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;

    const results = await yt.music.search(query, {
      type: "song"
    });

    const songs = results.songs.map(song => ({
      id: song.id,
      title: song.title?.text || "",
      artist: song.artists?.map(a => a.name).join(", ") || "",
      duration: song.duration?.text || "",
      thumbnail: song.thumbnails?.[0]?.url || ""
    }));

    res.json(songs);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

app.get("/audio/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const info = await yt.music.getInfo(id);

    const audioFormat = info.streaming_data?.formats
      ?.filter(f => f.mime_type.includes("audio"))
      ?.sort((a, b) => b.bitrate - a.bitrate)[0];

    if (!audioFormat) {
      return res.status(404).json({ error: "No se encontró audio" });
    }
    
    res.json({ url: audioFormat.url });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo audio" });
  }
});

app.listen(PORT, async () => {
  await initYT();
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

