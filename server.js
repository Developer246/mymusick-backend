const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let yt = null;
let isInitializing = false;

// Cache simple en memoria
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 10; // 10 minutos

/* ==============================
   INICIALIZACIÓN SEGURA
============================== */
async function initYT(retries = 3) {
  if (isInitializing) return;
  isInitializing = true;

  for (let i = 1; i <= retries; i++) {
    try {
      yt = await Innertube.create({
        client_type: "ANDROID_MUSIC"
      });

      console.log("🎵 YouTube Music inicializado");
      isInitializing = false;
      return;
    } catch (err) {
      console.error(`⚠ Intento ${i} fallido`, err.message);
      if (i === retries) {
        console.error("❌ No se pudo inicializar YouTube Music");
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

/* ==============================
   MIDDLEWARE
============================== */
function requireYT(req, res, next) {
  if (!yt) {
    return res.status(503).json({
      error: "Servicio no disponible",
      message: "YouTube Music no está listo"
    });
  }
  next();
}

/* ==============================
   MAPEO DE CANCIONES
============================== */
function mapSong(i) {
  const hdThumb = i.thumbnails?.reduce((best, thumb) => {
    const size = (thumb.width || 0) * (thumb.height || 0);
    const bestSize = (best?.width || 0) * (best?.height || 0);
    return size > bestSize ? thumb : best;
  }, null);

  return {
    id: i.videoId,
    title: i.name || i.title || "Sin título",
    artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
    album: i.album?.name || null,
    duration: i.duration?.text || null,
    thumbnail:
      hdThumb?.url?.replace(/w\d+-h\d+/, "w1080-h1080") || null
  };
}

/* ==============================
   SEARCH ENDPOINT (OPTIMIZADO)
============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search = await yt.music.search(q, {
      type: "song"
    });

    if (!search?.contents) return res.json([]);

    const songs = search.contents
      .filter(item => item.type === "MusicResponsiveListItem")
      .filter(item => item.videoId);

    const mapped = songs.map(item => {
      const thumb = item.thumbnails?.at(-1);

      return {
        id: item.videoId,
        title: item.title?.text || item.name || "Sin título",
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        duration: item.duration?.text || null,
        thumbnail: thumb?.url || null
      };
    });

    res.json(mapped);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Error buscando canciones" });
  }
});

/* ==============================
   HEALTH CHECK
============================== */
app.get("/health", (req, res) => {
  res.json({
    status: yt ? "OK" : "NOT_READY",
    uptime: process.uptime(),
    cacheSize: cache.size
  });
});

/* ==============================
   START SERVER
============================== */
app.listen(PORT, async () => {
  await initYT();
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});


