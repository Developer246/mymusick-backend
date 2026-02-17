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
    console.log("🎵 YouTube Music inicializado");
  } catch (err) {
    console.error("❌ Error iniciando YouTube Music:", err);
  }
})();

app.get("/search", async (req, res) => {
  try {
    if (!yt) return res.status(503).json([]);

    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents.find(
      s => Array.isArray(s?.contents)
    );

    if (!section) return res.json([]);

    const songs = section.contents
      .filter(item => item?.id)
      .slice(0, 10)
      .map(item => ({
        id: item.id,
        title: item.name?.text || item.title?.text || "Sin título",
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        thumbnail: item.thumbnails?.at(-1)?.url || null
      }));

    res.json(songs);
  } catch (err) {
    console.error("🔥 ERROR SEARCH:", err);
    res.status(500).json([]);
  }
});

app.get("/audio/:id", async (req, res) => {
  try {
    if (!yt) return res.status(503).send("YouTube no listo");

    const videoId = req.params.id;
    if (!videoId) return res.status(400).send("ID inválido");

    const info = await yt.getInfo(videoId);
    const stream = await info.download({
      type: "audio",
      quality: "best"
    });

    res.setHeader("Content-Type", "audio/webm");
    res.setHeader("Accept-Ranges", "bytes");

    stream.pipe(res);
  } catch (err) {
    console.error("🔥 ERROR AUDIO:", err);
    res.status(500).send("Error reproduciendo audio");
  }
});

app.get("/download/:id", async (req, res) => {
  try {
    if (!yt) return res.status(503).send("YouTube no listo");

    const videoId = req.params.id;
    if (!videoId) return res.status(400).send("ID inválido");

    const info = await yt.getInfo(videoId);
    const rawTitle = info.basic_info?.title || "audio";
    const safeTitle = rawTitle.replace(/[^\w\s-]/g, "").trim();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle}.webm"`
    );
    res.setHeader("Content-Type", "audio/webm");

    const stream = await info.download({
      type: "audio",
      quality: "best"
    });

    stream.pipe(res);
  } catch (err) {
    console.error("🔥 ERROR DOWNLOAD:", err);
    res.status(500).send("Error descargando audio");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend MYMUSICK en http://localhost:${PORT}`);
});

