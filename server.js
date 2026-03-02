const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

/* ===============================
   Inicialización simple
=============================== */
async function initYT() {
  yt = await Innertube.create({
    client_type: "ANDROID_MUSIC"
  });

  console.log("YouTube Music inicializado 🎵");
}

/* ===============================
   Middleware
=============================== */
function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({ error: "YT no inicializado" });
  }
  next();
}

/* ===============================
   🔎 SEARCH
=============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q);

    const resultsRaw =
      search.contents?.flatMap(section => section.contents || []) || [];

    const results = resultsRaw.slice(0, 10).map(i => ({
      id: i.id,
      title: i.name || i.title || "Sin título",
      artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
      duration: i.duration?.text || null,
      thumbnail: i.thumbnails?.at(-1)?.url || null
    }));

    res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error en búsqueda" });
  }
});

/* ===============================
   🎵 ALBUM
=============================== */
app.get("/album/:id", requireYT, async (req, res) => {
  try {
    const album = await yt.music.getAlbum(req.params.id);

    const tracks = (album.contents || []).map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artists?.map(a => a.name).join(", "),
      duration: track.duration?.text,
      thumbnail: track.thumbnails?.at(-1)?.url || null
    }));

    res.json(tracks);
  } catch (err) {
    console.error("Album error:", err);
    res.status(500).json({ error: "No se pudo obtener el álbum" });
  }
});

/* ===============================
   📃 PLAYLIST
=============================== */
app.get("/playlist/:id", requireYT, async (req, res) => {
  try {
    const playlist = await yt.music.getPlaylist(req.params.id);

    const tracks = (playlist.contents || []).map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artists?.map(a => a.name).join(", "),
      duration: track.duration?.text,
      thumbnail: track.thumbnails?.at(-1)?.url || null
    }));

    res.json(tracks);
  } catch (err) {
    console.error("Playlist error:", err);
    res.status(500).json({ error: "No se pudo obtener la playlist" });
  }
});

/* ===============================
   🚀 START
=============================== */
(async () => {
  try {
    await initYT();
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
    });
  } catch (err) {
    console.error("Error inicializando YT:", err);
    process.exit(1);
  }
})();
