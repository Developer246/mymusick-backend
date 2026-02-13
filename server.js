const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

(async () => {
  try {
    yt = await Innertube.create({
      client_type: "WEB_REMIX" 
    });

    console.log("YouTube Music listo 🎵");
  } catch (err) {
    console.error("Error iniciando YouTube Music:", err);
  }
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);


    const search = await yt.music.search(q, {
      type: "song"
    });

    const songs = search.contents.map(item => ({
      title: item.title?.text,
      artist: item.artists?.map(a => a.name).join(", "),
      album: item.album?.name,
      thumbnail: item.thumbnails?.[0]?.url,
      id: item.id
    }));

    res.json(songs);

  } catch (err) {
    console.error("ERROR YT MUSIC:", err);
    res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo 🚀 en puerto", PORT);
});

