require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { Innertube } = require("youtubei.js");
const { create: createYoutubeDl } = require("youtube-dl-exec");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const PORT = process.env.PORT || 8080;
const POT_SERVER = process.env.POT_SERVER || "http://127.0.0.1:4416";
const YTDLP_PATH = process.env.YTDLP_PATH || null;

const app = express();

// ==================== TRUST PROXY ====================
app.set('trust proxy', 1);

// ==================== CORS (PRIMERO QUE TODO) ====================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Range"],
  exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
}));

// Responde preflight OPTIONS en todas las rutas
app.options("*", cors());

// Header manual de respaldo (por si Railway intercepta antes)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
  res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ==================== OTROS MIDDLEWARES ====================
app.use(express.json());
app.use(morgan("dev"));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false
  }
}));

// ==================== GLOBALS ====================
let ytClient = null;
let youtubedl = null;
const urlCache = new Map();
const CACHE_TTL = 5 * 60 * 60 * 1000; // 5 horas

// ==================== INICIALIZACIÓN ====================
async function initYoutubeDl() {
  if (youtubedl) return youtubedl;

  const binaryPaths = [
    YTDLP_PATH,
    "/usr/local/bin/yt-dlp",
    "/usr/local/bin/YT-DLP",
    "/usr/bin/yt-dlp",
    path.join(__dirname, "node_modules/.bin/yt-dlp"),
  ].filter(Boolean);

  for (const binPath of binaryPaths) {
    if (binPath && fs.existsSync(binPath)) {
      try {
        const instance = createYoutubeDl(binPath);
        await instance("--version");
        youtubedl = instance;
        console.log(`✅ yt-dlp inicializado: ${binPath}`);
        return youtubedl;
      } catch (e) {
        console.warn(`⚠️  Falló prueba con ${binPath}`);
      }
    }
  }
  throw new Error("❌ No se encontró yt-dlp. Instálalo o configura YTDLP_PATH.");
}

async function getYT() {
  if (!ytClient) {
    ytClient = await Innertube.create({ client_type: "WEB_REMIX" });
    console.log("✅ Cliente YouTube Music (Innertube) listo");
  }
  return ytClient;
}

// ==================== HELPERS ====================
function getBestThumbnail(id) {
  return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : null;
}

function getCache(id) {
  const entry = urlCache.get(id);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry;
  urlCache.delete(id);
  return null;
}

// ==================== OBTENER URL DE AUDIO ====================
async function getAudioUrl(id) {
  const cached = getCache(id);
  if (cached) return cached;

  await initYoutubeDl();

  const url = `https://www.youtube.com/watch?v=${id}`;
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    format: "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
    noPlaylist: true,
    extractorArgs: `youtubepot-bgutilhttp:base_url=${POT_SERVER}`,
  });

  const audioFormat = info.formats
    ?.filter(f => f.acodec !== "none" && f.vcodec === "none" && f.url)
    ?.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  const entry = {
    streamUrl: audioFormat?.url || info.url,
    mimeType: audioFormat?.ext === "webm" ? "audio/webm; codecs=opus"
            : audioFormat?.ext === "m4a" ? "audio/mp4"
            : "audio/webm",
    filesize: audioFormat?.filesize || audioFormat?.filesize_approx || null,
    httpHeaders: audioFormat?.http_headers || {},
    ts: Date.now(),
  };

  urlCache.set(id, entry);
  return entry;
}

// ==================== FETCH JSON HELPER ====================
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          reject(new Error("Error parseando JSON"));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// ==================== RUTAS ====================

// 🔍 BÚSQUEDA
app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q || q.length < 2) {
      return res.json({ songs: [], artists: [], albums: [] });
    }

    const yt = await getYT();

    let searchResult;
    try {
      searchResult = await yt.music.search(q);
    } catch (e) {
      console.warn("WEB_REMIX falló, intentando con WEB...", e.message);
      ytClient = null;
      const ytWeb = await Innertube.create({ client_type: "WEB" });
      searchResult = await ytWeb.search(q);
    }

    let items = [];
    if (searchResult?.results?.length) {
      items = searchResult.results;
    } else if (searchResult?.contents) {
      items = searchResult.contents.flatMap(section => section?.contents || []);
    } else if (searchResult?.on_response_received_commands) {
      items = searchResult.on_response_received_commands
        .flatMap(cmd => cmd?.appendContinuationItemsAction?.continuationItems || []);
    }

    const songs = items
      .filter(item => item?.id || item?.videoId)
      .slice(0, 20)
      .map(item => ({
        id: item.id || item.videoId,
        title: item.title?.text || item.title || "Sin título",
        artist: Array.isArray(item.artists)
          ? item.artists.map(a => a.name || a.text).filter(Boolean).join(", ")
          : item.author?.name || item.channelTitle || "Desconocido",
        album: item.album?.name || item.album?.text || null,
        duration: item.duration?.text || item.lengthText || null,
        thumbnail: item.thumbnails?.[0]?.url ||
                   (item.id ? `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg` : null)
      }));

    console.log(`✅ Búsqueda "${q}" → ${songs.length} canciones encontradas`);

    res.json({ songs, artists: [], albums: [] });

  } catch (err) {
    console.error("❌ Error crítico en /search:", err);
    res.status(500).json({
      songs: [],
      artists: [],
      albums: [],
      error: "Error interno en la búsqueda"
    });
  }
});

// 🎵 STREAMING con Range Requests
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id.length !== 11) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const { streamUrl, mimeType, httpHeaders } = await getAudioUrl(id);

    const ytHeaders = {
      "User-Agent": httpHeaders["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    };

    if (req.headers.range) ytHeaders.Range = req.headers.range;

    const protocol = streamUrl.startsWith("https") ? https : http;

    const ytReq = protocol.get(streamUrl, { headers: ytHeaders }, (ytRes) => {
      const status = ytRes.statusCode === 206 ? 206 : 200;

      const headers = {
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      };

      if (ytRes.headers["content-length"]) headers["Content-Length"] = ytRes.headers["content-length"];
      if (ytRes.headers["content-range"]) headers["Content-Range"] = ytRes.headers["content-range"];

      res.writeHead(status, headers);
      ytRes.pipe(res);
    });

    ytReq.on("error", (err) => {
      console.error("Stream error:", err);
      urlCache.delete(id);
      if (!res.headersSent) res.status(502).json({ error: "Error al conectar con YouTube" });
    });

    req.on("close", () => ytReq.destroy());

  } catch (err) {
    console.error("Error en /stream:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  }
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error("❌ Error no manejado:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ==================== START SERVER ====================
async function start() {
  try {
    await initYoutubeDl();
    await getYT();

    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`   POT_SERVER configurado: ${POT_SERVER}`);
    });
  } catch (err) {
    console.error("❌ Error al iniciar el servidor:", err);
    process.exit(1);
  }
}

start();
