const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

/* ───── Inicializar YouTube Music ───── */
(async () => {
  try {
    yt = await Innertube.create({
      client_type: "WEB_REMIX"
    });
    console.log("🎵 YouTube Music listo");
  } catch (err) {
    console.error("❌ Error iniciando YouTube Music:", err);
  }
})();

/* ───── Ruta de búsqueda ───── */
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q || !yt) return res.json([]);

    const search = await yt.music.search(q, { type: "song" });

    const songsSection = search.contents.find(
      s => Array.isArray(s?.contents)
    );

    if (!songsSection) return res.json([]);

    const songs = songsSection.contents
      .filter(item => item?.id)
      .slice(0, 10)
      .map(item => ({
        title:
        item.title?.text ||
        item.title?.runs?.map(r => r.text).join("") ||
        item.flex_columns?.[0]?.text?.runs?.map(r => r.text).join("") ||
        "Sin título",
        
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        thumbnail: item.thumbnails?.slice(-1)[0]?.url || null,
        id: item.id
      }));

    res.json(songs);
  } catch (err) {
    console.error("🔥 ERROR SEARCH:", err);
    res.status(500).json([]);
  }
});

/* ───── Ruta de audio (streaming) ───── */
app.get("/audio/:id", async (req, res) => {
  try {
    if (!yt) return res.status(503).send("YouTube no listo");

    const info = await yt.getInfo(req.params.id);
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

/* ───── Ruta de descarga (NUEVA) ───── */
app.get("/download/:id", async (req, res) => {
  try {
    if (!yt) return res.status(503).send("YouTube no listo");

    const videoId = req.params.id;
    const info = await yt.getInfo(videoId);

    const title =
      info.basic_info?.title?.replace(/[^\w\s-]/g, "") || "audio";

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${title}.webm"`
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

/* ───── Servidor ───── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

