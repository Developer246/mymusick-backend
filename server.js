const express    = require("express");
const cors       = require("cors");
const ytdl       = require("@distube/ytdl-core");
const { Innertube } = require("youtubei.js");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
=============================== */
let ytMusic = null;
let ytAgent = null;

/* ===============================
   PARSEAR cookies.txt (formato Netscape)
   desde variable de entorno YOUTUBE_COOKIES
=============================== */
function parseCookiesTxt(content) {
  return content
    .split("\n")
    .filter(line => line.trim() && !line.startsWith("#"))
    .map(line => {
      const parts = line.split("\t");
      if (parts.length < 7) return null;
      return {
        domain:   parts[0],
        httpOnly: parts[1] === "TRUE",
        path:     parts[2],
        secure:   parts[3] === "TRUE",
        expires:  parseInt(parts[4]) || 0,
        name:     parts[5],
        value:    parts[6].trim(),
      };
    })
    .filter(Boolean);
}

function loadAgent() {
  const raw = process.env.YOUTUBE_COOKIES;

  if (!raw) {
    console.warn("⚠️  YOUTUBE_COOKIES no definida — las peticiones pueden ser bloqueadas");
    return null;
  }

  try {
    const cookies = parseCookiesTxt(raw);
    const agent   = ytdl.createAgent(cookies);
    console.log(`🍪 ${cookies.length} cookies cargadas desde variable de entorno`);
    return agent;
  } catch (err) {
    console.error("❌ Error cargando cookies:", err.message);
    return null;
  }
}

/* ===============================
   INICIALIZACIÓN
=============================== */
async function initYT() {
  ytMusic = await Innertube.create({ client_type: "WEB_REMIX" });
  ytAgent = loadAgent();
  console.log("✅ YouTube Music inicializado");
}

/* ===============================
   MIDDLEWARE
=============================== */
function requireYT(req, res, next) {
  if (!ytMusic) return res.status(503).json({ error: "Servidor aún inicializando" });
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
=============================== */
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;

  if (!ytdl.validateID(id)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const url        = `https://www.youtube.com/watch?v=${id}`;
    const infoOpts   = ytAgent ? { agent: ytAgent } : {};
    const streamOpts = {
      quality: "highestaudio",
      filter:  "audioonly",
      ...infoOpts,
    };

    const info   = await ytdl.getInfo(url, infoOpts);
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter:  "audioonly",
    });

    if (!format) {
      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    res.setHeader("Content-Type",  format.mimeType?.split(";")[0] || "audio/webm");
    res.setHeader("Cache-Control", "no-store");

    ytdl(url, streamOpts)
      .on("error", err => {
        console.error("❌ ytdl stream error:", err.message);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);

  } catch (err) {
    console.error("❌ /stream error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error obteniendo audio", message: err.message });
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
    cookiesLoaded: !!ytAgent,
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
})();  return thumbnails.reduce((best, thumb) => {
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
   @distube/ytdl-core maneja el
   descifrado de forma nativa
=============================== */
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;

  if (!ytdl.validateID(id)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const url  = `https://www.youtube.com/watch?v=${id}`;
    const info = await ytdl.getInfo(url);

    // Elegir el mejor formato de solo audio
    const format = ytdl.chooseFormat(info.formats, {
      quality:   "highestaudio",
      filter:    "audioonly",
    });

    if (!format) {
      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    res.setHeader("Content-Type",  format.mimeType?.split(";")[0] || "audio/webm");
    res.setHeader("Cache-Control", "no-store");

    // Pipe directo: ytdl → response
    ytdl(url, { format })
      .on("error", err => {
        console.error("❌ ytdl stream error:", err.message);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);

  } catch (err) {
    console.error("❌ /stream error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error obteniendo audio", message: err.message });
    }
  }
});

/* ===============================
   GET /health
=============================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok", ytMusicReady: !!ytMusic, port: PORT });
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
