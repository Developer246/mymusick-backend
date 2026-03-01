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
    if (!yt) {
      return res.status(503).json({ error: "YouTube Music no está inicializado" });
    }

    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: "Falta parámetro q" });
    }

    const results = await yt.music.search(query, { type: "song" });
    console.log("Resultados crudos:", JSON.stringify(results, null, 2));

    // En v16 los resultados están en results.items
    const songs = results.items?.map(item => ({
      id: item.id,
      title: item.title?.text || "",
      artist: item.artists?.map(a => a.name).join(", ") || "",
      duration: item.duration?.text || "",
      thumbnail: item.thumbnails?.[0]?.url || ""
    })) || [];

    res.json(songs);

  } catch (error) {
    console.error("Error en /search:", error);
    res.status(500).json({ error: error.message });
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

