const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

(async () => {
  yt = await Innertube.create({ client_type: "WEB_REMIX" });
})();

app.get("/search", async (req, res) => {
  try {
    if (!yt) return res.json([]);

    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });
    const section = search.contents.find(s => Array.isArray(s?.contents));
    if (!section) return res.json([]);

    const baseSongs = section.contents
      .filter(item => item?.id)
      .slice(0, 10);

    const songs = await Promise.all(
      baseSongs.map(async item => {
        try {
          const info = await yt.getInfo(item.id);
          return {
            id: item.id,
            title: info.basic_info?.title || "Sin título",
            artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
            album: item.album?.name || null,
            thumbnail: item.thumbnails?.at(-1)?.url || null
          };
        } catch {
          return {
            id: item.id,
            title: "Sin título",
            artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
            album: item.album?.name || null,
            thumbnail: item.thumbnails?.at(-1)?.url || null
          };
        }
      })
    );

    res.json(songs);
  } catch {
    res.status(500).json([]);
  }
});

app.get("/audio/:id", async (req, res) => {
  try {
    if (!yt) return res.sendStatus(503);

    const info = await yt.getInfo(req.params.id);
    const stream = await info.download({ type: "audio", quality: "best" });

    res.setHeader("Content-Type", "audio/webm");
    res.setHeader("Accept-Ranges", "bytes");

    stream.pipe(res);
  } catch {
    res.sendStatus(500);
  }
});

app.get("/download/:id", async (req, res) => {
  try {
    if (!yt) return res.sendStatus(503);

    const info = await yt.getInfo(req.params.id);
    const title = (info.basic_info?.title || "audio")
      .replace(/[^\w\s-]/g, "")
      .trim();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${title}.webm"`
    );
    res.setHeader("Content-Type", "audio/webm");

    const stream = await info.download({ type: "audio", quality: "best" });
    stream.pipe(res);
  } catch {
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT);
