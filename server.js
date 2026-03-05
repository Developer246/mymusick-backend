const express = require("express");
const cors    = require("cors");
const { Innertube } = require("youtubei.js");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
=============================== */
let yt = null;

/* ===============================
   INICIALIZACIÓN DE YOUTUBE
=============================== */
async function initYT() {
  yt = await Innertube.create({ client_type: "WEB_REMIX" });
  console.log("✅ YouTube Music inicializado");
}

/* ===============================
   MIDDLEWARE — YT listo
=============================== */
function requireYT(req, res, next) {
  if (!yt) return res.status(503).json({ error: "Servidor aún inicializando, intenta de nuevo" });
  next();
}

/* ===============================
   UTILIDADES
=============================== */

function getBestThumbnail(thumbnails = []) {
  return thumbnails.reduce((best, thumb) => {
    const size     = (thumb.width  || 0) * (thumb.height || 0);
    const bestSize = (best?.width  || 0) * (best?.height || 0);
    return size > bestSize ? thumb : best;
  }, null);
}

function toHDThumbnail(url = "") {
  return url.replace(/w\d+-h\d+/, "w1080-h1080");
}

function parseCipher(cipher) {
  const p   = new URLSearchParams(cipher);
  const url = p.get("url");
  const sp  = p.get("sp");
  const sig = p.get("sig");
  if (!url || !sp || !sig) throw new Error("Cipher incompleto");
  return `${url}&${sp}=${sig}`;
}

function durationToSeconds(text = "") {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/* ===============================
   GET /search
=============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search  = await yt.music.search(q, { type: "song" });
    const section = search.contents?.find(s => Array.isArray(s?.contents));

    if (!section) return res.json([]);

    const songs = section.contents
      .filter(item => item?.videoId || item?.id)
      .slice(0, 10)
      .map(item => {
        const thumb = getBestThumbnail(item.thumbnails);
        return {
          id:        item.videoId || item.id,
          title:     item.name   || item.title || "Sin título",
          artist:    item.artists?.map(a => a.name).join(", ") || "Desconocido",
          album:     item.album?.name  || null,
          duration:  item.duration?.text || null,
          seconds:   item.duration?.text ? durationToSeconds(item.duration.text) : null,
          thumbnail: thumb ? toHDThumbnail(thumb.url) : null,
        };
      });

    res.json(songs);

  } catch (err) {
    console.error("❌ /search error:", err.message);
    res.status(500).json({ error: "Error buscando canciones", message: err.message });
  }
});

/* ===============================
   GET /stream/:id
=============================== */
app.get("/stream/:id", requireYT, async (req, res) => {
  const { id } = req.params;

  if (!id?.match(/^[\w-]{5,20}$/)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const info = await yt.getBasicInfo(id);

    const formats = [
      ...(info.streaming_data?.adaptive_formats || []),
      ...(info.streaming_data?.formats          || []),
    ];

    const audio = formats
      .filter(f => f.mime_type?.includes("audio"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audio) {
      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    if (!audio.url && audio.signatureCipher) {
      audio.url = parseCipher(audio.signatureCipher);
    }

    if (!audio.url) {
      return res.status(404).json({ error: "URL de audio no disponible" });
    }

    const upstream = await fetch(audio.url);

    if (!upstream.ok) {
      return res.status(502).json({ error: `YouTube respondió con ${upstream.status}` });
    }

    res.setHeader("Content-Type",  audio.mime_type || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    const reader = upstream.body.getReader();

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(value);
      }
    };

    pump().catch(err => {
      console.error("❌ Error en pump:", err.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error("❌ /stream error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error procesando el stream", message: err.message });
    }
  }
});

/* ===============================
   GET /health
=============================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok", ytReady: !!yt, port: PORT });
});

/* ===============================
   ARRANQUE
=============================== */
(async () => {
  try {
    await initYT();
    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();

