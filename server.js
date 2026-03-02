const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

/* =========================
   INIT YT MUSIC
========================= */
async function initYT() {
  yt = await Innertube.create({
    client_type: "ANDROID_MUSIC"
  });

  console.log("🎵 YTMusic iniciado");
}

/* =========================
   SEARCH YTMUSIC
========================= */
app.get("/search", async (req, res) => {
  try {
    if (!yt) await initYT();

    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, {
      type: "song",
      limit: 25
    });

    if (!search?.contents) return res.json([]);

    const songs = search.contents
      .filter(item => item.videoId && item.type === "MusicResponsiveListItem")
      .map(item => ({
        id: item.videoId,
        type: "song",
        title: item.title?.text || "Sin título",
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        duration: item.duration?.text || null,
        thumbnail: item.thumbnails?.at(-1)?.url || null
      }));

    res.json(songs);

  } catch (err) {
    console.error("❌ YTMusic error:", err.message);
    yt = null; // reinicia si falla
    res.status(500).json({ error: "Error en YTMusic" });
  }
});

/* =========================
   START
========================= */
app.listen(PORT, async () => {
  await initYT();
  console.log(`🚀 Servidor YTMusic en puerto ${PORT}`);
});

