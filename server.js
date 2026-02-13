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
    console.log("🎵 YouTube Music listo");
  } catch (err) {
    console.error("❌ Error iniciando YouTube Music:", err);
  }
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q || !yt) {
      return res.json([]);
    }

    const search = await yt.music.search(q, { type: "song" });
    
    const songsSection = search.contents.find(
      section =>
        Array.isArray(section?.contents) &&
        section.contents.some(item => item?.id && item?.title)
    );

    if (!songsSection) {
      return res.json([]);
    }

    const songs = songsSection.contents
      .filter(item => item?.id && item?.title)
      .slice(0, 10)
      .map(item => ({
        title:
          item.title?.text ||
          item.title?.runs?.map(r => r.text).join("") ||
          "Sin título",
        artist:
          item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        thumbnail: item.thumbnails?.slice(-1)[0]?.url || null,
        id: item.id
      }));

    console.log(`🔎 "${q}" → ${songs.length} resultados`);
    res.json(songs);

  } catch (err) {
    console.error("🔥 ERROR YT MUSIC:", err);
    res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});


