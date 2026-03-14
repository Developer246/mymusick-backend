const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");
const ytdl = require("ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let ytMusic = null;

// Inicializa cliente de YouTube Music
async function getYTMusic() {
  if (ytMusic) return ytMusic;
  ytMusic = await Innertube.create({ client_type: "WEB_REMIX" });
  console.log("✅ Innertube listo para búsquedas");
  return ytMusic;
}

// Helpers
function getBestThumbnail(thumbnails = []) {
  return thumbnails.reduce((best, thumb) => {
    const size = (thumb.width || 0) * (thumb.height || 0);
    const bestSize = (best?.width || 0) * (best?.height || 0);
    return size > bestSize ? thumb : best;
  }, null);
}

function toHDThumbnail(url = "") {
  return url.replace(/w\\d+-h\\d+/, "w1080-h1080");
}

function durationToSeconds(text = "") {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// 🔍 Endpoint de búsqueda
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const yt = await getYTMusic();
    const search = await yt.music.search(q, { type: "song" });

    let items = [];
    for (const section of (search.contents || [])) {
      if (Array.isArray(section?.contents)) {
        const found = section.contents.filter(i => i?.videoId || i?.id);
        if (found.length) { items = found; break; }
      }
    }

    if (!items.length) return res.json([]);

    const songs = items.slice(0, 10).map(item => {
      const thumb = getBestThumbnail(item.thumbnails);
      return {
        id: item.videoId || item.id,
        title: item.name || item.title || "Sin título",
        artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: item.album?.name || null,
        duration: item.duration?.text || null,
        seconds: item.duration?.text ? durationToSeconds(item.duration.text) : null,
        thumbnail: thumb ? toHDThumbnail(thumb.url) : null,
      };
    });

    res.json(songs);

  } catch (err) {
    console.error("❌ /search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones", message: err.message });
  }
});

// 🎵 Stream con ytdl-core normal
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "ID requerido" });

  try {
    console.log(`🎵 Stream: ${id}`);

    const stream = ytdl(id, {
      quality: "highestaudio",
      requestOptions: {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }
    });

    stream.on("info", (info, format) => {
      res.setHeader("Content-Type", format.mimeType || "audio/webm");
      if (format.contentLength) {
        res.setHeader("Content-Length", format.contentLength);
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Accept-Ranges", "bytes");
    });

    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("❌ ytdl error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error obteniendo audio", message: err.message });
      }
    });

  } catch (err) {
    console.error("❌ /stream error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error obteniendo audio", message: err.message });
    }
  }
});

// 🩺 Health check y raíz
app.get("/", (req, res) => {
  res.send("Backend funcionando 🚀");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", ytReady: !!ytMusic, port: PORT });
});

// Arranque
(async () => {
  try {
    await getYTMusic();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor en puerto ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();
