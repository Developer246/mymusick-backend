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
app.set("trust proxy", 1);

// ==================== CORS ====================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Range"],
  exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
}));
app.options("*", cors());
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
  validate: { xForwardedForHeader: false },
}));

// ==================== GLOBALS ====================
let ytClient  = null;
let youtubedl = null;
const urlCache = new Map();
const CACHE_TTL = 5 * 60 * 60 * 1000; // 5 horas

// ==================== INICIALIZACIÓN ====================
async function initYoutubeDl() {
  if (youtubedl) return youtubedl;

  const binaryPaths = [
    YTDLP_PATH,
    "/usr/local/bin/yt-dlp",
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

// Miniatura de mayor resolución ordenando por área (width × height)
// Reemplaza el parámetro de tamaño en URLs de googleusercontent/yt3 para obtener máxima calidad
function upgradeThumbnailUrl(url) {
  if (!url) return url;
  // URLs tipo: =w120-h120-l90-rj → reemplazar por =w544-h544-l90-rj
  // s0 = tamaño original sin límite (máxima resolución disponible)
  return url.replace(/=w\d+-h\d+[-\w]*/, "=s0");
}

function getBestThumbnail(id, thumbnails) {
  if (Array.isArray(thumbnails) && thumbnails.length) {
    const best = thumbnails
      .filter(t => t?.url)
      .sort((a, b) => ((b.width||0)*(b.height||0)) - ((a.width||0)*(a.height||0)))[0]?.url || null;
    return upgradeThumbnailUrl(best);
  }
  return null;
}

function getCache(id) {
  const entry = urlCache.get(id);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry;
  urlCache.delete(id);
  return null;
}

function isValidVideoId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function isSongTitle(title) {
  if (!title) return false;
  const blocklist = [
    /\d+\s*hora/i, /greatest hits/i, /top \d+/i, /\bmix\b/i,
    /playlist/i, /video oficial/i, /official video/i,
    /concierto/i, /en vivo/i, /\blive\b/i, /compilaci[oó]n/i,
    /full album/i, /nrtv/i, /neiel rivera/i,
  ];
  return !blocklist.some(re => re.test(title));
}

function extractArtistName(item) {
  if (Array.isArray(item.artists) && item.artists.length) {
    return item.artists.map(a => a.name || a.text).filter(Boolean).join(", ");
  }
  if (item.author?.name) return item.author.name;
  if (Array.isArray(item.flex_columns)) {
    const runs = item.flex_columns[1]?.title?.runs || [];
    const hit = runs.find(r => r.endpoint?.payload?.browseId?.startsWith("UC"));
    if (hit) return hit.text;
    if (runs[0]?.text) return runs[0].text;
  }
  return "Desconocido";
}

function extractAlbumName(item) {
  if (item.album?.name) return item.album.name;
  if (item.album?.text) return item.album.text;
  if (Array.isArray(item.flex_columns)) {
    const runs = item.flex_columns[2]?.title?.runs || [];
    const hit = runs.find(r => r.endpoint?.payload?.browseId?.startsWith("MPREb"));
    if (hit) return hit.text;
    if (runs[0]?.text) return runs[0].text;
  }
  return null;
}

function flattenItems(result) {
  if (result?.results?.length) return result.results;
  if (result?.contents) return result.contents.flatMap(s => s?.contents || []);
  if (result?.on_response_received_commands) {
    return result.on_response_received_commands
      .flatMap(cmd => cmd?.appendContinuationItemsAction?.continuationItems || []);
  }
  return [];
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
    extractorArgs: "youtubepot-bgutilhttp:base_url=" + POT_SERVER,
    // Indicar a yt-dlp dónde está Node.js para descifrar YouTube
    jsRuntimes: "node:" + (process.env.NODE_PATH || process.execPath),
  });

  const audioFormat = info.formats
    ?.filter(f => f.acodec !== "none" && f.vcodec === "none" && f.url)
    ?.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

  const entry = {
    streamUrl:   audioFormat?.url || info.url,
    mimeType:    audioFormat?.ext === "webm" ? "audio/webm; codecs=opus"
               : audioFormat?.ext === "m4a"  ? "audio/mp4"
               : "audio/webm",
    filesize:    audioFormat?.filesize || audioFormat?.filesize_approx || null,
    httpHeaders: audioFormat?.http_headers || {},
    ts:          Date.now(),
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
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

    // 3 búsquedas en paralelo
    const [songResult, artistResult, albumResult] = await Promise.allSettled([
      yt.music.search(q, { type: "song"   }),
      yt.music.search(q, { type: "artist" }),
      yt.music.search(q, { type: "album"  }),
    ]);

    // ── CANCIONES ──────────────────────────────────────────────────────────
    const songItems = songResult.status === "fulfilled"
      ? flattenItems(songResult.value) : [];

    const songs = songItems
      .filter(item => {
        const id = item?.id || item?.videoId;
        if (!isValidVideoId(id)) return false;
        const duration = item?.duration?.text || item?.duration?.seconds || item?.lengthText;
        if (!duration) return false;
        const title = item?.title?.text || item?.title || "";
        return isSongTitle(title);
      })
      .slice(0, 20)
      .map(item => {
        const id = item.id || item.videoId;
        return {
          id,
          title:     item.title?.text || item.title || "Sin título",
          artist:    extractArtistName(item),
          album:     extractAlbumName(item),
          duration:  item.duration?.text || item.lengthText?.simpleText || item.lengthText || null,
          thumbnail: getBestThumbnail(id, item.thumbnails),
        };
      });

    // ── ARTISTAS ───────────────────────────────────────────────────────────
    const artistItems = artistResult.status === "fulfilled"
      ? flattenItems(artistResult.value) : [];

    const artists = artistItems
      .filter(i => i && (i.id || i.browseId))
      .slice(0, 8)
      .map(i => ({
        id:          i.id || i.browseId,
        name:        i.name || i.title?.text || i.title || "Desconocido",
        subscribers: i.subscribers?.text || i.subscribers || null,
        thumbnail:   getBestThumbnail(null, i.thumbnails || i.thumbnail),
      }));

    // ── ÁLBUMES ────────────────────────────────────────────────────────────
    const albumItems = albumResult.status === "fulfilled"
      ? flattenItems(albumResult.value) : [];

    const albums = albumItems
      .filter(i => i && (i.id || i.playlistId || i.browseId))
      .slice(0, 8)
      .map(i => ({
        id:        i.id || i.playlistId || i.browseId,
        title:     i.title?.text || i.title || "Sin título",
        artist:    Array.isArray(i.artists)
                     ? i.artists.map(a => a.name || a.text).filter(Boolean).join(", ")
                     : i.author?.name || null,
        year:      i.year || null,
        thumbnail: getBestThumbnail(null, i.thumbnails || i.thumbnail),
      }));

    console.log(`✅ "${q}" → ${songs.length} canciones, ${artists.length} artistas, ${albums.length} álbumes`);
    res.json({ songs, artists, albums });

  } catch (err) {
    console.error("❌ Error en /search:", err.message);
    res.status(500).json({ songs: [], artists: [], albums: [], error: "Error interno" });
  }
});

// 🎵 HEAD request — devuelve metadatos sin body (para que el player conozca el tamaño)
app.head("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id.length !== 11) return res.status(400).end();
  try {
    const { mimeType, filesize } = await getAudioUrl(id);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (filesize) res.setHeader("Content-Length", filesize);
    res.status(200).end();
  } catch (err) {
    res.status(500).end();
  }
});

// 🎵 STREAMING con Range Requests
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id.length !== 11) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const { streamUrl, mimeType, filesize, httpHeaders } = await getAudioUrl(id);

    console.log(`🎵 Stream ${id} | size: ${filesize} | mime: ${mimeType}`);

    const rangeHeader = req.headers.range;

    const ytHeaders = {
      "User-Agent": httpHeaders["User-Agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
      // Siempre enviar Range — sin esto YouTube no devuelve Content-Length
      "Range": rangeHeader || "bytes=0-",
    };

    const protocol = streamUrl.startsWith("https") ? https : http;

    const ytReq = protocol.get(streamUrl, { headers: ytHeaders }, (ytRes) => {
      console.log(`📡 YouTube respondió ${ytRes.statusCode} | content-length: ${ytRes.headers["content-length"]} | content-range: ${ytRes.headers["content-range"]}`);

      const status = rangeHeader ? 206 : 200;

      const headers = {
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      };

      // Content-Length: necesario para que el player calcule duración
      if (ytRes.headers["content-length"]) {
        headers["Content-Length"] = ytRes.headers["content-length"];
      } else if (filesize) {
        headers["Content-Length"] = filesize;
      }

      // Content-Range: necesario para seek
      if (ytRes.headers["content-range"]) {
        headers["Content-Range"] = ytRes.headers["content-range"];
      } else if (filesize) {
        const match = (rangeHeader || "bytes=0-").match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end   = match[2] ? parseInt(match[2]) : filesize - 1;
          headers["Content-Range"] = `bytes ${start}-${end}/${filesize}`;
        }
      }

      res.writeHead(status, headers);
      ytRes.pipe(res);
      ytRes.on("error", e => console.error(`❌ Pipe error ${id}:`, e.message));
    });

    ytReq.on("error", (err) => {
      console.error("Stream error:", err.message);
      urlCache.delete(id);
      if (!res.headersSent) res.status(502).json({ error: "Error al conectar con YouTube" });
    });

    req.on("close", () => ytReq.destroy());

  } catch (err) {
    console.error("Error en /stream:", err.message);
    urlCache.delete(id);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// 🎤 LETRAS
app.get("/lyrics/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "ID inválido" });

  try {
    const apiUrl = `https://api-lyrics.simpmusic.org/v1/search?q=${encodeURIComponent(id)}`;
    const { status, body } = await fetchJson(apiUrl);

    if (status !== 200 || !body) {
      return res.status(404).json({ error: "Letras no encontradas" });
    }

    console.log(`✅ Letras obtenidas para ${id}`);
    res.json(body);
  } catch (err) {
    console.error(`❌ Error en /lyrics ${id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🩺 HEALTH CHECK
app.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    ytReady:    !!ytClient,
    ytdlpReady: !!youtubedl,
    cachedUrls: urlCache.size,
    potServer:  POT_SERVER,
    port:       PORT,
  });
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error("❌ Error no manejado:", err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ==================== START ====================
async function start() {
  try {
    await initYoutubeDl();
    await getYT();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`   POT_SERVER: ${POT_SERVER}`);
    });
  } catch (err) {
    console.error("❌ Error al iniciar:", err.message);
    process.exit(1);
  }
}

start();
