const express   = require("express");
const cors      = require("cors");
const { spawn } = require("child_process");
const { Innertube } = require("youtubei.js");
const fs        = require("fs");
const path      = require("path");
const https     = require("https");

const app     = express();
const PORT    = process.env.PORT || 3000;
const YTDLP   = path.join("/tmp", "yt-dlp_linux");
const COOKIES = path.join("/tmp", "cookies.txt");

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
=============================== */
let ytMusic     = null;
let initPromise = null;

/* ===============================
   DESCARGAR yt-dlp a /tmp
=============================== */
function downloadYtDlp() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(YTDLP)) {
      console.log("✅ yt-dlp ya existe en /tmp");
      return resolve();
    }

    console.log("⬇️  Descargando yt-dlp...");
    const file = fs.createWriteStream(YTDLP);

    const request = (reqUrl) => {
      https.get(reqUrl, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            fs.chmodSync(YTDLP, 0o755);
            console.log("✅ yt-dlp listo");
            resolve();
          });
        });
      }).on("error", err => {
        fs.unlink(YTDLP, () => {});
        reject(err);
      });
    };

    // yt-dlp_linux es binario autocontenido, no requiere Python
    request("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux");
  });
}

/* ===============================
   ESCRIBIR COOKIES A /tmp
   Render puede escapar los saltos de línea
   como \n literales — los restauramos
=============================== */
function writeCookies() {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) {
    console.warn("⚠️  YOUTUBE_COOKIES no definida");
    return false;
  }
  try {
    // Convertir \n literales a saltos de línea reales
    const content = raw.replace(/\\n/g, "\n");
    fs.writeFileSync(COOKIES, content, "utf-8");

    const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#"));
    console.log(`🍪 ${lines.length} cookies escritas en /tmp`);
    console.log(`🍪 Primera línea de datos: ${lines[0]?.substring(0, 60)}...`);
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
      "-f", "bestaudio/best",
      "--get-url",
    ];

    if (fs.existsSync(COOKIES)) {
      args.push("--cookies", COOKIES);
      console.log(`🍪 Pasando cookies a yt-dlp: ${COOKIES}`);
    } else {
      console.warn("⚠️  Sin cookies para yt-dlp");
    }

    args.push(`https://www.youtube.com/watch?v=${videoId}`);
    console.log(`▶ yt-dlp ${args.join(" ")}`);

    const proc = spawn(YTDLP, args);
    let url = "", errOut = "";

    proc.stdout.on("data", d => { url    += d.toString(); });
    proc.stderr.on("data", d => { errOut += d.toString(); });

    proc.on("close", code => {
      url = url.trim();
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(new Error(errOut.trim() || `yt-dlp código ${code}`));
      }
    });

    proc.on("error", e => reject(new Error(`yt-dlp error: ${e.message}`)));
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

    // youtubei.js v16 puede anidar los resultados en distintos niveles
    let items = [];

    for (const section of (search.contents || [])) {
      // Nivel directo
      if (Array.isArray(section?.contents)) {
        const found = section.contents.filter(i => i?.videoId || i?.id);
        if (found.length) { items = found; break; }
      }
      // Nivel anidado (MusicShelf, etc.)
      if (Array.isArray(section?.contents)) {
        for (const sub of section.contents) {
          if (Array.isArray(sub?.contents)) {
            const found = sub.contents.filter(i => i?.videoId || i?.id);
            if (found.length) { items = found; break; }
          }
        }
      }
      if (items.length) break;
    }

    console.log(`📦 Items encontrados: ${items.length}`);
    if (!items.length) return res.json([]);

    const songs = items
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
  const cookieContent = fs.existsSync(COOKIES)
    ? fs.readFileSync(COOKIES, "utf-8").split("\n").filter(l => l.trim() && !l.startsWith("#")).length
    : 0;

  res.json({
    status:       "ok",
    ytReady:      !!ytMusic,
    ytdlpExists:  fs.existsSync(YTDLP),
    cookiesExist: fs.existsSync(COOKIES),
    cookieLines:  cookieContent,
    port:         PORT,
  });
});

/* ===============================
   ARRANQUE
=============================== */
(async () => {
  try {
    writeCookies();
    await downloadYtDlp();
    await getYTMusic();
    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();
