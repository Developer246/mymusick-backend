const express = require("express");
const cors = require("cors");
const ytdl = require("ytdl-core");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

(async () => {
  yt = await Innertube.create({ client_type: "WEB_REMIX" });
  console.log("🎵 YouTube Music listo");
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || !yt) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });
    res.json(search); // devuelve todo el resultado crudo

  } catch (e) {
    console.error(e);
    res.json([]);
  }
});

