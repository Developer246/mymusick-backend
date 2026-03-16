require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { Innertube } = require("youtubei.js");
const { create: createYoutubeDl } = require("youtube-dl-exec");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 8080;
const POT_SERVER = process.env.POT_SERVER || "http://127.0.0.1:4416";

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

let ytClient  = null;
let youtubedl = null;

// ✅ Inicializar yt-dlp
async function initYoutubeDl() {
  if (youtubedl) return youtubedl;

  const binaryPaths = [
    process.env.YTDLP_PATH,
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    path.join(__dirname, "node_modules", "youtube-dl-exec", "bin", "yt-dlp"),
  ].filter(Boolean);

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      try {
        const instance = createYoutubeDl(binPath);
        await instance("--version", { printJson: false });
        youtubedl = instance;
        console.log(`✅ yt-dlp listo (${binPath})`);
        return youtubedl;
      } catch (_) {
        youtubedl = null;
      }
    }
  }

  throw new Error("yt-dlp no encontrado.");
}

// ✅ Inicializar cliente YouTube Music
async function getYT() {
  if (!ytClient) {
    ytClient = await Innertube.create({ client_type: "WEB_REMIX" });
    console.log("✅ Cliente YouTube Music listo");
  }
  return ytClient;
}

// Obtener la miniatura de mayor resolución disponible
function getBestThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  return thumbnails
    .filter((t) => t?.url)
    .sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaB - areaA;
    })[0]?.url || thumbnails[thumbnails.length - 1]?.url || null;
}

// Cache de URLs de audio (las URLs de YouTube duran ~6 horas)
const urlCache = new Map();
const CACHE_TTL = 5 * 60 * 60 * 1000;

async function getAudioUrl(id) {
  const cached = urlCache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached;

  await initYoutubeDl();
  const url = `https://www.youtube.com/watch?v=${id}`;

  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    format: "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
    noPlaylist: true,
  });

  const audioFormat = info.formats
    ?.filter((f) => f.acodec !== "none" && f.vcodec === "none" && f.url)
    ?.sort((a, b) => (b.abr || 0) - (a.abr || 0))?.[0];

  const streamUrl   = audioFormat?.url || info.url;
  const mimeType    = audioFormat?.ext === "webm" ? "audio/webm; codecs=opus"
                    : audioFormat?.ext === "m4a"  ? "audio/mp4"
                    : "audio/webm";
  const filesize    = audioFormat?.filesize || audioFormat?.filesize_approx || null;
  const httpHeaders = audioFormat?.http_headers || {};

  const entry = { streamUrl, mimeType, filesize, httpHeaders, ts: Date.now() };
  urlCache.set(id, entry);
  return entry;
}

// Helper para hacer GET a una URL y retornar JSON
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const protocol = parsed.protocol === "https:" ? https : http;

    const req = protocol.get(
      url,
      { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error("Error parseando JSON de respuesta"));
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("Timeout en la petición"));
    });
  });
}

// 🔍 Búsqueda de canciones
app.get("/search", async (req, res, next) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const yt = await getYT();
    const search = await yt.music.search(q, { type: "song" });

    const items = Array.isArray(search.contents)
      ? search.contents.flatMap((s) => s.contents || [])
      : [];

    const songs = items
      .filter((i) => i?.id || i?.video_id)
      .slice(0, 10)
      .map((i) => ({
        id: i.id || i.video_id,
        title: i.title || "Sin título",
        artist: i.artists?.map((a) => a.name).join(", ") || "Desconocido",
        album: i.album?.name || null,
        duration: i.duration?.text || null,
        thumbnail: getBestThumbnail(i.thumbnails),
      }));

    res.json(songs);
  } catch (err) {
    next(err);
  }
});

// 🎵 Streaming de audio con soporte completo de Range
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "ID inválido", code: 400 });

  try {
    const { streamUrl, mimeType, filesize, httpHeaders } = await getAudioUrl(id);

    const ytHeaders = {
      "User-Agent": httpHeaders["User-Agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    };

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      ytHeaders["Range"] = rangeHeader;
    } else if (filesize) {
      ytHeaders["Range"] = "bytes=0-";
    }

    const parsedUrl = new URL(streamUrl);
    const protocol  = parsedUrl.protocol === "https:" ? https : http;

    const ytReq = protocol.get(streamUrl, { headers: ytHeaders }, (ytRes) => {
      const isPartial = ytRes.statusCode === 206;
      const status    = isPartial ? 206 : 200;

      const headers = {
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      };

      if (ytRes.headers["content-length"]) {
        headers["Content-Length"] = ytRes.headers["content-length"];
      } else if (filesize && !rangeHeader) {
        headers["Content-Length"] = filesize;
      }

      if (ytRes.headers["content-range"]) {
        headers["Content-Range"] = ytRes.headers["content-range"];
      } else if (filesize && rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end   = match[2] ? parseInt(match[2]) : filesize - 1;
          headers["Content-Range"] = `bytes ${start}-${end}/${filesize}`;
        }
      }

      res.writeHead(status, headers);
      ytRes.pipe(res);
      ytRes.on("error", (e) => console.error(`❌ Pipe error ${id}:`, e.message));
    });

    ytReq.on("error", (err) => {
      console.error(`❌ Request error ${id}:`, err.message);
      urlCache.delete(id);
      if (!res.headersSent) {
        res.status(500).json({ error: "No se pudo conectar al servidor de audio", code: 500 });
      }
    });

    req.on("close", () => ytReq.destroy());
    console.log(`✅ Stream ${rangeHeader ? "(range)" : "(full)"} para ${id}`);

  } catch (err) {
    console.error(`❌ Error en stream ${id}:`, err.message);
    urlCache.delete(id);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, code: 500 });
    }
  }
});

// 🎤 Letras de canciones via simpmusic API
app.get("/lyrics/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "ID inválido", code: 400 });

  try {
    const apiUrl = `https://api-lyrics.simpmusic.org/v1/search?q=${encodeURIComponent(id)}`;
    const { status, body } = await fetchJson(apiUrl);

    if (status !== 200 || !body) {
      return res.status(404).json({ error: "Letras no encontradas", code: 404 });
    }

    console.log(`✅ Letras obtenidas para ${id}`);
    res.json(body);
  } catch (err) {
    console.error(`❌ Error en lyrics ${id}:`, err.message);
    res.status(500).json({ error: err.message, code: 500 });
  }
});

// 🩺 Health check
app.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    ytReady: !!ytClient,
    ytdlpReady: !!youtubedl,
    cachedUrls: urlCache.size,
    potServer: POT_SERVER,
    port: PORT,
  });
});

// Middleware de errores
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(err.statusCode || 500).json({
    error: "Error interno",
    message: err.message || "Algo salió mal",
    code: err.statusCode || 500,
  });
});

// 🚀 Arranque
(async () => {
  try {
    await Promise.all([getYT(), initYoutubeDl()]);
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error("❌ Error arrancando:", err.message);
    process.exit(1);
  }
})();
