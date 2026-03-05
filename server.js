const express    = require("express");
const cors       = require("cors");
const { spawn }  = require("child_process");
const { Innertube } = require("youtubei.js");
const fs         = require("fs");
const path       = require("path");

const app     = express();
const PORT    = process.env.PORT || 3000;
const YTDLP   = path.join(__dirname, "bin", "yt-dlp");
const COOKIES = path.join(__dirname, "cookies.txt");

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
=============================== */
let ytMusic     = null;
let initPromise = null;

/* ===============================
   ESCRIBIR COOKIES AL DISCO
   yt-dlp necesita un archivo físico
=============================== */
function writeCookies() {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) {
    console.warn("⚠️  YOUTUBE_COOKIES no definida");
    return false;
  }
  try {
    fs.writeFileSync(COOKIES, raw, "utf-8");
    console.log("🍪 cookies.txt escrito en disco");
    return true;
  } catch (err) {
    console.error("❌ Error escribiendo cookies:", err.message);
    return false;
  }
}

/* ===============================
   INICIALIZAR INNERTUBE
=============================== */
async function getYTMusic() {
  if (ytMusic) return ytMusic;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    ytMusic     = await Innertube.create({ client_type: "WEB_REMIX" });
    initPromise = null;
    console.log("✅ Innertube listo");
    return ytMusic;
  })();

  return initPromise;
}

/* ===============================
   OBTENER URL DE AUDIO CON yt-dlp
=============================== */
function getAudioUrl(videoId) {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
      "--get-url",
    ];

    // Usar cookies si existen
    if (fs.existsSync(COOKIES)) {
      args.push("--cookies", COOKIES);
    }

    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const proc = spawn(YTDLP, args);
    let url = "", err = "";

    proc.stdout.on("data", d => { url += d.toString(); });
    proc.stderr.on("data", d => { err += d.toString(); });

    proc.on("close", code => {
      url = url.trim();
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(new Error(err.trim() || `yt-dlp código ${code}`));
      }
    });

    proc.on("error", e => reject(new Error(`yt-dlp no encontrado: ${e.message}`)));
  });
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
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const t0 = Date.now();
    let yt;

    try {
      yt = await getYTMusic();
    } catch {
      return res.status(503).json({ error: "Servicio no disponible" });
    }

    let search;
    try {
      search = await yt.music.search(q, { type: "song" });
    } catch {
      ytMusic = null;
      yt      = await getYTMusic();
      search  = await yt.music.search(q, { type: "song" });
    }

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

    console.log(`🔍 "${q}" → ${songs.length} resultados en ${Date.now() - t0}ms`);
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

  if (!id?.match(/^[\w-]{5,20}$/)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    console.log(`🎵 Obteniendo audio: ${id}`);
    const audioUrl = await getAudioUrl(id);
    console.log(`✅ Redirect para: ${id}`);
    res.redirect(302, audioUrl);
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
    status:       "ok",
    ytReady:      !!ytMusic,
    ytdlpExists:  fs.existsSync(YTDLP),
    cookiesExist: fs.existsSync(COOKIES),
    port:         PORT,
  });
});

/* ===============================
   ARRANQUE
=============================== */
(async () => {
  try {
    writeCookies();
    await getYTMusic();
    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();
