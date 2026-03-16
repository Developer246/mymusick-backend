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
app.use(helmet());

let ytClient = null;
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
        console.log(`🔑 POT server: ${POT_SERVER}`);
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
        thumbnail: i.thumbnails?.[0]?.url || null,
      }));

    res.json(songs);
  } catch (err) {
    next(err);
  }
});

// 🎵 Streaming de audio — pipe a través del servidor (evita 403 de googlevideo)
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      error: "Stream fallido",
      message: "ID inválido o requerido",
      code: 400,
    });
  }

  try {
    await initYoutubeDl();

    const url = `https://www.youtube.com/watch?v=${id}`;

    // Obtener info del video (URL directa del audio)
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      format: "bestaudio[ext=webm]/bestaudio/best",
      noPlaylist: true,
    });

    // Mejor formato de solo audio
    const audioFormat = info.formats
      ?.filter((f) => f.acodec !== "none" && f.vcodec === "none" && f.url)
      ?.sort((a, b) => (b.abr || 0) - (a.abr || 0))?.[0];

    const streamUrl = audioFormat?.url || info.url;
    const mimeType = audioFormat?.audio_ext === "webm"
      ? "audio/webm; codecs=opus"
      : "audio/mpeg";
    const contentLength = audioFormat?.filesize || audioFormat?.filesize_approx || null;

    if (!streamUrl) {
      return res.status(404).json({
        error: "Stream fallido",
        message: "No se encontró URL de audio",
        code: 404,
      });
    }

    console.log(`✅ Iniciando pipe para ${id} (${mimeType})`);

    // Headers que YouTube espera — sin ellos devuelve 403
    const ytHeaders = {
      "User-Agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
      "Sec-Fetch-Dest": "audio",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
    };

    // Soporte de range requests (necesario para seek en el player)
    if (req.headers.range) {
      ytHeaders["Range"] = req.headers.range;
    }

    const parsedUrl = new URL(streamUrl);
    const protocol = parsedUrl.protocol === "https:" ? https : http;

    const ytReq = protocol.get(
      streamUrl,
      { headers: ytHeaders },
      (ytRes) => {
        // Propagar código de estado (200 o 206 para range)
        const statusCode = ytRes.statusCode === 206 ? 206 : 200;

        res.status(statusCode);
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (ytRes.headers["content-length"]) {
          res.setHeader("Content-Length", ytRes.headers["content-length"]);
        } else if (contentLength) {
          res.setHeader("Content-Length", contentLength);
        }

        if (ytRes.headers["content-range"]) {
          res.setHeader("Content-Range", ytRes.headers["content-range"]);
        }

        // Pipe: YouTube → nuestro servidor → cliente
        ytRes.pipe(res);

        ytRes.on("error", (err) => {
          console.error("❌ Error en pipe de YouTube:", err.message);
        });
      }
    );

    ytReq.on("error", (err) => {
      console.error("❌ Error conectando a YouTube:", err.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Stream fallido",
          message: "No se pudo conectar al servidor de audio",
          code: 500,
        });
      }
    });

    // Si el cliente corta la conexión, cancelar la petición a YouTube
    req.on("close", () => {
      ytReq.destroy();
    });

  } catch (err) {
    console.error(`❌ Error en stream ${id}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Stream fallido",
        message: err.message,
        code: 500,
      });
    }
  }
});

// 🩺 Health check
app.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    ytReady: !!ytClient,
    ytdlpReady: !!youtubedl,
    potServer: POT_SERVER,
    port: PORT,
  });
});

// Middleware de errores centralizado
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
