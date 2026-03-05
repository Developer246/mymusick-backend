const express    = require("express");
const cors       = require("cors");
const { spawn }  = require("child_process");
const { Innertube } = require("youtubei.js");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
=============================== */
let ytMusic = null;

/* ===============================
   INICIALIZACIÓN
=============================== */
async function initYT() {
  ytMusic = await Innertube.create({ client_type: "WEB_REMIX" });
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
   Obtener URL de audio con yt-dlp
   Devuelve una Promise<string>
=============================== */
function getAudioUrl(videoId) {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const proc = spawn("yt-dlp", [
      "--no-playlist",
      "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
      "--get-url",
      ytUrl,
    ]);

    let url    = "";
    let errOut = "";

    proc.stdout.on("data", chunk => { url += chunk.toString(); });
    proc.stderr.on("data", chunk => { errOut += chunk.toString(); });

    proc.on("close", code => {
      url = url.trim();
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(new Error(errOut.trim() || `yt-dlp salió con código ${code}`));
      }
    });

    proc.on("error", err => {
      reject(new Error(`No se pudo ejecutar yt-dlp: ${err.message}`));
    });
  });
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
   yt-dlp extrae la URL directa
   y hacemos proxy del audio
=============================== */
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;

  if (!id?.match(/^[\w-]{5,20}$/)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    console.log(`🎵 Obteniendo audio para: ${id}`);
    const audioUrl = await getAudioUrl(id);
    console.log(`✅ URL obtenida para: ${id}`);

    // Proxy: redirigir al cliente directamente a la URL
    // (más eficiente que hacer pipe en el servidor)
    return res.redirect(302, audioUrl);

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
