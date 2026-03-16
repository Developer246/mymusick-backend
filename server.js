require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { Innertube } = require("youtubei.js");
const { create: createYoutubeDl } = require("youtube-dl-exec");
const path = require("path");
const fs = require("fs");

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

// 🎵 Streaming de audio con PO Token
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

    // El plugin bgutil-ytdlp-pot-provider detecta automáticamente
    // el servidor POT en localhost:4416 — no hace falta extractor-args
    // si el servidor está en el puerto por defecto
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      format: "bestaudio/best",
      noPlaylist: true,
    });

    // Mejor formato de solo audio
    const audioFormat = info.formats
      ?.filter((f) => f.acodec !== "none" && f.vcodec === "none" && f.url)
      ?.sort((a, b) => (b.abr || 0) - (a.abr || 0))?.[0];

    const streamUrl = audioFormat?.url || info.url;

    if (!streamUrl) {
      return res.status(404).json({
        error: "Stream fallido",
        message: "No se encontró URL de audio",
        code: 404,
      });
    }

    console.log(`✅ Stream listo para ${id}`);
    return res.redirect(streamUrl);

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
