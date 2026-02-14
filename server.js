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
    const section = search.contents.find(s => s?.contents);

    const songs = section.contents
      .filter(i => i?.id && i?.title)
      .slice(0, 10)
      .map(i => ({
        title: i.title.text,
        artist: i.artists?.map(a => a.name).join(", "),
        thumbnail: i.thumbnails?.slice(-1)[0]?.url,
        id: i.id
      }));

    res.json(songs);
  } catch (e) {
    console.error(e);
    res.json([]);
  }
});

app.get("/audio/:id", async (req, res) => {
  const id = req.params.id;

  if (!/^[a-zA-Z0-9-_]{11}$/.test(id)) {
    console.error("❌ ID inválido:", id);
    return res.status(400).json({ error: "ID de video inválido" });
  }

  const url = `https://www.youtube.com/watch?v=${id}`;

  try {
    res.setHeader("Content-Type", "audio/mpeg");

    ytdl(url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25
    }).pipe(res);

  } catch (err) {
    console.error("🔥 Error audio:", err);
    res.sendStatus(500);
  }
});
