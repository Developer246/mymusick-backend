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

/** Devuelve la miniatura de mayor resolución */
function getBestThumbnail(thumbnails = []) {
  return thumbnails.reduce((best, thumb) => {
    const size     = (thumb.width  || 0) * (thumb.height || 0);
    const bestSize = (best?.width  || 0) * (best?.height || 0);
    return size > bestSize ? thumb : best;
  }, null);
}

/** Convierte una URL de miniatura a 1080×1080 */
function toHDThumbnail(url = "") {
  return url.replace(/w\d+-h\d+/, "w1080-h1080");
}

/** Decodifica una signatureCipher en URL reproducible */
function parseCipher(cipher) {
  const p = new URLSearchParams(cipher);
  const url = p.get("url");
  const sp  = p.get("sp");
  const sig = p.get("sig");

  if (!url || !sp || !sig) throw new Error("Cipher incompleto");
  return `${url}&${sp}=${sig}`;
}

/** Normaliza el texto de duración a segundos (ej: "3:45" → 225) */
function durationToSeconds(text = "") {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/* ===============================
   GET /search  — Buscar canciones
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
          title:     item.name   || item.title  || "Sin título",
          artist:    item.artists?.map(a => a.name).join(", ") || "Desconocido",
          album:     item.album?.name   || null,
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
   GET /stream/:id  — Proxy de audio
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

    // Filtramos solo audio y ordenamos por bitrate descendente
    const audioFormats = formats
      .filter(f => f.mime_type?.includes("audio"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const audio = audioFormats[0];

    if (!audio) {
      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    // Resolver URL si está cifrada
    if (!audio.url && audio.signatureCipher) {
      audio.url = parseCipher(audio.signatureCipher);
    }

    if (!audio.url) {
      return res.status(404).json({ error: "URL de audio no disponible" });
    }

    // Proxy del stream
    const upstream = await fetch(audio.url);

    if (!upstream.ok) {
      return res.status(502).json({ error: `YouTube respondió con ${upstream.status}` });
    }

    res.setHeader("Content-Type",  audio.mime_type || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    // Transmitir chunk a chunk
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
   GET /health  — Estado del servidor
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
})();  try {
    const q = req.query.q?.trim();
    if (!q) {
      return res.json([]);
    }

    const search = await yt.music.search(q, { type: "song" });

    const section = search.contents?.find(section =>
      Array.isArray(section?.contents)
    );

    if (!section) {
      return res.json([]);
    }

    const songs = section.contents
      .filter(item => item?.videoId || item?.id)
      .slice(0, 10)
      .map(item => {
        const hdThumb = getBestThumbnail(item.thumbnails);

        return {
          id: item.videoId || item.id,
          title: item.name || item.title || "Sin título",
          artist: item.artists?.map(a => a.name).join(", ") || "Desconocido",
          album: item.album?.name || null,
          duration: item.duration?.text || null,
          thumbnail: hdThumb
            ? hdThumb.url.replace(/w\\d+-h\\d+/, "w1080-h1080")
            : null
        };
      });

    res.json(songs);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      error: "Error buscando canciones",
      message: err.message
    });
  }
});
function getBestThumbnail(thumbnails = []) 
{ return thumbnails.reduce((best, thumb) => 
   { const currentSize = (thumb.width || 0) * (thumb.height || 0); 
    const bestSize = (best?.width || 0) * (best?.height || 0); 
    return currentSize > bestSize ? thumb : best;},
null);
}
/* ===============================
   🎧 STREAM PROXY
=============================== */
function parseCipher(cipher) {
  const params = new URLSearchParams(cipher);
  return `${params.get("url")}&${params.get("sp")}=${params.get("sig")}`;
}

app.get("/stream/:id", requireYT, async (req, res) => {
  try {
    // ⚡ Usamos getBasicInfo en lugar de getInfo
    const info = await yt.getBasicInfo(req.params.id);

    const formats = [
      ...(info.streaming_data?.adaptive_formats || []),
      ...(info.streaming_data?.formats || [])
    ];

    let audio = formats
      .filter(f => f.mime_type?.includes("audio"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audio?.url && audio?.signatureCipher) {
      try {
        audio.url = parseCipher(audio.signatureCipher);
      } catch (err) {
        console.error("Cipher parse error:", err);
        return res.status(500).json({ error: "No se pudo decodificar el audio", message: err.message });
      }
    }

    if (!audio?.url) {
      return res.status(404).json({ error: "Audio no disponible" });
    }

    const response = await fetch(audio.url);

    if (!response.body) {
      return res.status(500).json({ error: "No se pudo obtener el audio" });
    }

    res.setHeader("Content-Type", audio.mime_type || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    response.body.on("data", chunk => res.write(chunk));
    response.body.on("end", () => res.end());
    response.body.on("error", err => {
      console.error("Stream error:", err);
      res.status(500).json({ error: "Error en el stream", message: err.message });
    });

  } catch (err) {
    console.error("Stream error REAL:", err);
    res.status(500).json({
      error: "Error procesando stream",
      message: err.message
    });
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

