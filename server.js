require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { Innertube } = require("youtubei.js");
const { create: createYoutubeDl } = require("youtube-dl-exec");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(helmet());

let ytClient = null;
let youtubedl = null;

// ✅ Inicializar youtube-dl-exec apuntando al binario de yt-dlp
async function initYoutubeDl() {
  if (youtubedl) return youtubedl;

  // Rutas donde youtube-dl-exec instala el binario automáticamente
  const binaryPaths = [
    process.env.YTDLP_PATH,
    path.join(__dirname, "node_modules", "youtube-dl-exec", "bin", "yt-dlp"),
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ].filter(Boolean);

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      try {
        youtubedl = createYoutubeDl(binPath);
        // Verificar que funciona
        const result = await youtubedl("--version", { printJson: false });
        console.log(`✅ youtube-dl-exec listo (${binPath})`);
        return youtubedl;
      } catch (_) {
        youtubedl = null;
      }
    }
  }

  throw new Error("yt-dlp binario no encontrado. Revisa la instalación de youtube-dl-exec.");
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

// 🎵 Streaming de audio
// Estrategia: obtener URL directa con youtube-dl-exec y redirigir al cliente
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

    // Obtener la URL directa del audio sin descargar nada
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      format: "bestaudio/best",
      noPlaylist: true,
    });

    // Buscar la URL del mejor formato de audio
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

    console.log(`✅ Stream via redirect para ${id}`);
    // Redirigir: el audio fluye de YouTube al cliente directamente
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

// 🚀 Arranque del servidor
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
