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
let ytMusic = null;   // WEB_REMIX  → búsquedas
let ytTV    = null;   // TV_EMBEDDED → streaming sin cifrado ni player JS

/* ===============================
   INICIALIZACIÓN
=============================== */
async function initYT() {
  ytMusic = await Innertube.create({ client_type: "WEB_REMIX" });
  ytTV    = await Innertube.create({ client_type: "TV_EMBEDDED" });
  console.log("✅ Clientes YouTube inicializados");
}

/* ===============================
   MIDDLEWARE
=============================== */
function requireYT(req, res, next) {
  if (!ytMusic || !ytTV) {
    return res.status(503).json({ error: "Servidor aún inicializando, intenta de nuevo" });
  }
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

function durationToSeconds(text = "") {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/* ===============================
   Extraer URL de audio de streaming_data
   sin depender de chooseFormat
=============================== */
function extractAudioUrl(streamingData) {
  const formats = [
    ...(streamingData?.adaptive_formats || []),
    ...(streamingData?.formats          || []),
  ];

  // Solo audio, con URL directa, ordenado por bitrate
  const audioFormats = formats
    .filter(f => f.mime_type?.includes("audio") && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return audioFormats[0] || null;
}

/* ===============================
   GET /search
=============================== */
app.get("/search", requireYT, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const search  = await ytMusic.music.search(q, { type: "song" });
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
    // TV_EMBEDDED no requiere descifrado y acepta la API sin restricciones
    const info   = await ytTV.getInfo(id);
    const format = extractAudioUrl(info.streaming_data);

    if (!format) {
      // Log de depuración
      const all = [
        ...(info.streaming_data?.adaptive_formats || []),
        ...(info.streaming_data?.formats          || []),
      ];
      console.error(`❌ Sin formatos de audio para ${id}. Total formatos: ${all.length}`);
      all.forEach(f => console.error(`  mime=${f.mime_type} bitrate=${f.bitrate} hasUrl=${!!f.url}`));

      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    const upstream = await fetch(format.url);

    if (!upstream.ok) {
      return res.status(502).json({ error: `YouTube respondió con ${upstream.status}` });
    }

    res.setHeader("Content-Type",  format.mime_type?.split(";")[0] || "audio/webm");
    res.setHeader("Cache-Control", "no-store");

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      res.write(value);
    }

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
  res.json({
    status:       "ok",
    ytMusicReady: !!ytMusic,
    ytTVReady:    !!ytTV,
    port:         PORT,
  });
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
