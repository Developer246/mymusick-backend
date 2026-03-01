const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

let yt;

// Inicializa YouTube Music con cookies desde variable de entorno
async function initYT() {
  const cookie = process.env.YTM_COOKIE;
  yt = await Innertube.create({
    client_type: "ANDROID_MUSIC",
    cookie
  });
  console.log("YouTube Music inicializado con cookies 🎵");
}

// Middleware para asegurar que yt esté listo
function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({ error: "YouTube Music no está inicializado" });
  }
  next();
}

// 🔎 Endpoint de búsqueda
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q);
    const section = search.contents?.find(s => Array.isArray(s?.contents));
    if (!section) return res.json([]);

    const results = section.contents.slice(0, 10).map(i => {
      let type = "other";
      if (i.videoId) type = "song";
      else if (i.album) type = "album";
      else if (i.playlist) type = "playlist";
      else if (i.artist) type = "artist";

      const hdThumb = i.thumbnails?.reduce((best, thumb) => {
        const currentSize = (thumb.width || 0) * (thumb.height || 0);
        const bestSize = (best?.width || 0) * (best?.height || 0);
        return currentSize > bestSize ? thumb : best;
      }, null);

      return {
        id: i.videoId || i.browseId || i.id,
        type,
        title: i.name || i.title || "Sin título",
        artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: i.album?.name || null,
        duration: i.duration?.text || null,
        thumbnail: hdThumb?.url?.replace(/w\\d+-h\\d+/, "w1080-h1080") || null
      };
    });

    res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

// 🔎 Endpoint para expandir álbumes
app.get("/album/:browseId", requireYT, async (req, res) => {
  try {
    const album = await yt.music.getAlbum(req.params.browseId);
    const tracks = album.contents.map(track => ({
      id: track.videoId,
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

// 🔎 Endpoint para expandir playlists
app.get("/playlist/:browseId", requireYT, async (req, res) => {
  try {
    const playlist = await yt.music.getPlaylist(req.params.browseId);
    const tracks = playlist.contents.map(track => ({
      id: track.videoId,
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

// 🚀 Arranca el servidor
app.listen(PORT, async () => {
  await initYT();
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
