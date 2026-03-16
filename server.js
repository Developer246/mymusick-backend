require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { Innertube } = require("youtubei.js");
const YTDlpWrap = require("yt-dlp-wrap").default;
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(helmet());

let ytMusic = null;
let ytDlpWrap = null;

// ✅ Inicializar yt-dlp apuntando al binario del sistema
async function initYTDlp() {
  if (ytDlpWrap) return ytDlpWrap;

  const binaryPaths = [
    process.env.YTDLP_PATH,
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ].filter(Boolean);

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      try {
        const instance = new YTDlpWrap(binPath);
        const version = await instance.getVersion();
        ytDlpWrap = instance;
        console.log(`✅ yt-dlp listo v${version} (${binPath})`);
        return ytDlpWrap;
      } catch (_) {
        // Intentar siguiente ruta
      }
    }
  }

  throw new Error(
    "yt-dlp no encontrado en el sistema. Agrégalo al Dockerfile con: pip install yt-dlp"
  );
}

// ✅ Inicializar cliente YouTube Music
async function getYTMusic() {
  if (!ytMusic) {
    ytMusic = await Innertube.create({ client_type: "WEB_REMIX" });
    console.log("✅ Cliente YouTube Music listo");
  }
  return ytMusic;
}

// 🔍 Búsqueda de canciones
app.get("/search", async (req, res, next) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const yt = await getYTMusic();
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

// 🎵 Streaming de audio
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
    await initYTDlp();

    const url = `https://www.youtube.com/watch?v=${id}`;

    const child = ytDlpWrap.exec(
      ["-f", "bestaudio/best[ext=webm]/best", "--no-playlist", "-o", "-", url],
      { cwd: __dirname }
    );

    res.setHeader("Content-Type", "audio/webm; codecs=opus");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Transfer-Encoding", "chunked");

    child.stdout.pipe(res);

    child.stdout.on("error", (err) => {
      console.error("❌ Error en stdout:", err.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Stream fallido",
          message: "Error en el stream de audio",
          code: 500,
        });
      }
    });

    child.on("error", (err) => {
      console.error("❌ Error en yt-dlp:", err.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Stream fallido",
          message: err.message.includes("ENOENT")
            ? "yt-dlp no instalado. Revisa el Dockerfile."
            : "No se pudo procesar el video",
          code: 500,
        });
      }
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`⚠️ yt-dlp terminó con código ${code}`);
      }
    });

    req.setTimeout(30000);
    res.socket?.setTimeout(60000);
  } catch (err) {
    console.error("❌ Error preparando stream:", err.message);
    res.status(500).json({
      error: "Stream fallido",
      message: err.message,
      code: 500,
    });
  }
});

// 🩺 Health check
app.get("/health", async (req, res) => {
  try {
    const ytdlpVersion = ytDlpWrap
      ? await ytDlpWrap.getVersion().catch(() => "error al obtener versión")
      : "no inicializado";

    res.json({
      status: "ok",
      ytReady: !!ytMusic,
      ytdlpReady: !!ytDlpWrap,
      ytdlpVersion,
      port: PORT,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
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

// 🚀 Arranque del servidor
(async () => {
  try {
    await Promise.all([getYTMusic(), initYTDlp()]);

    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error("❌ Error arrancando:", err.message);
    process.exit(1);
  }
})();
