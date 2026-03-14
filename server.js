const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(new Error(`Origen no permitido: ${origin}`));
  }
}));
app.use(express.json());

let ytMusic = null;
let initPromise = null;

async function getYTMusic() {
  if (ytMusic) return ytMusic;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const yt = await Innertube.create({ client_type: "WEB_REMIX" });
    console.log("✅ Innertube listo (sin OAuth ni cookies)");
    ytMusic = yt;
    initPromise = null;
    return ytMusic;
  })();

  return initPromise;
}

function getBestThumbnail(thumbnails = []) {
  return thumbnails.reduce((best, thumb) => {
    const size = (thumb.width || 0) * (thumb.height || 0);
    const bestSize = (best?.width || 0) * (best?.height || 0);
    return size > bestSize ? thumb : best;
  }, null);
}

function toHDThumbnail(url = "") {
  return url.replace(/w\d+-h\d+/, "w1080-h1080");
}

function durationToSeconds(text = "") {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// 🔍 Buscar canciones
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

// 🎵 Stream directo usando youtubei.js
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id?.match(/^[\w-]{5,20}$/)) return res.status(400).json({ error: "ID inválido" });

  try {
    const yt = await getYTMusic();
    const info = await yt.getBasicInfo(id); // ✅ más seguro que getInfo
    const audioFormat = info.streaming_data?.adaptive_formats?.find(f => f.mime_type.includes("audio"));
    if (!audioFormat) return res.status(404).json({ error: "No se encontró audio" });

    const audioUrl = audioFormat.url;
    const upstream = await fetch(audioUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Range": req.headers.range || "bytes=0-",
      }
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
    }

    const ct = upstream.headers.get("content-type");
    const cl = upstream.headers.get("content-length");
    const cr = upstream.headers.get("content-range");

    if (ct) res.setHeader("Content-Type", ct.split(";")[0]);
    if (cl) res.setHeader("Content-Length", cl);
    if (cr) res.setHeader("Content-Range", cr);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.status(upstream.status === 206 ? 206 : 200);

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      res.write(value);
    }

  } catch (err) {
    console.error("❌ /stream error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Error obteniendo audio", message: err.message });
  }
});

// 🩺 Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    ytReady: !!ytMusic,
    port: PORT,
  });
});

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

