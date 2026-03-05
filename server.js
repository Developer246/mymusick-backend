const express = require("express");
const cors    = require("cors");
const { Innertube } = require("youtubei.js");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
   - ytMusic   : WEB_REMIX  → búsquedas
   - ytAndroid : ANDROID    → streaming (URLs sin cifrar, no necesita player JS)
=============================== */
let ytMusic   = null;
let ytAndroid = null;

/* ===============================
   INICIALIZACIÓN
=============================== */
async function initYT() {
  ytMusic = await Innertube.create({ client_type: "WEB_REMIX" });

  // ANDROID devuelve streaming URLs directas, sin necesidad de descifrar
  ytAndroid = await Innertube.create({ client_type: "ANDROID" });

  console.log("✅ Clientes YouTube inicializados");
}

/* ===============================
   MIDDLEWARE
=============================== */
function requireYT(req, res, next) {
  if (!ytMusic || !ytAndroid) {
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
   Cliente ANDROID: devuelve URLs
   de audio directas, sin cifrado
=============================== */
app.get("/stream/:id", requireYT, async (req, res) => {
  const { id } = req.params;

  if (!id?.match(/^[\w-]{5,20}$/)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const info = await ytAndroid.getInfo(id);

    // Seleccionar mejor formato de audio disponible
    const format = info.chooseFormat({
      type:    "audio",
      quality: "best",
    });

    if (!format?.url) {
      // Log para depuración
      const allFormats = [
        ...(info.streaming_data?.adaptive_formats || []),
        ...(info.streaming_data?.formats          || []),
      ];
      console.error("Formatos disponibles:", allFormats.map(f => ({
        mime: f.mime_type,
        bitrate: f.bitrate,
        hasUrl: !!f.url,
      })));
      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    // Hacer proxy de la URL directa
    const upstream = await fetch(format.url, {
      headers: {
        // Header necesario para algunas URLs de YouTube
        "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
      }
    });

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
    status:        "ok",
    ytMusicReady:  !!ytMusic,
    ytAndroidReady: !!ytAndroid,
    port:          PORT,
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
