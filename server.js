const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

(async () => {
  try {
    yt = await Innertube.create({
      client_type: "WEB"
    });

    console.log("YouTube listo 🎶");
  } catch (err) {
    console.error("Error iniciando YouTube:", err);
  }
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);

    const results = await yt.search(q);

    const songs = results.results
      .filter(item => item.type === "Video")
      .map(item => ({
        title: item.title?.text,
        artist: item.author?.name,
        thumbnail: item.thumbnails?.[0]?.url,
        id: item.id
      }));

    res.json(songs);
  } catch (err) {
    console.error("ERROR YT:", err);
    res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo 🚀 en puerto", PORT);
});
