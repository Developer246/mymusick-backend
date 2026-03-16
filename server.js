require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { Innertube } = require("youtubei.js");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(helmet());

let ytMusic = null;

// Inicializa cliente de YouTube Music
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
      ? search.contents.flatMap(s => s.contents || [])
      : [];

    const songs = items
      .filter(i => i?.id || i?.video_id)
      .slice(0, 10)
      .map(i => ({
        id: i.id || i.video_id,
        title: i.title || "Sin título",
        artist: i.artists?.map(a => a.name).join(", ") || "Desconocido",
        album: i.album?.name || null,
        duration: i.duration?.text || null,
        thumbnail: i.thumbnails?.[0]?.url || null,
      }));

    res.json(songs);
  } catch (err) {
    next(err);
  }
});
const YTDlpWrap = require("yt-dlp-wrap").default;
const ytDlpWrap = new YTDlpWrap();
// 🎵 Streaming de audio usando yt-dlp
app.get("/stream/:id", (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({
      error: "Stream fallido",
      message: "ID inválido o requerido",
      code: 400
    });
  }

  const url = `https://www.youtube.com/watch?v=${id}`;

  // Ejecuta yt-dlp para obtener el mejor audio disponible
  const ytdlp = spawn("yt-dlp", [
    "-f", "bestaudio",
    "-o", "-", // salida estándar
    url
  ]);

  res.setHeader("Content-Type", "audio/webm");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "bytes");

  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on("data", data => {
    console.error("yt-dlp error:", data.toString());
  });

  ytdlp.on("error", err => {
    console.error("❌ Error en yt-dlp:", err);
    res.status(500).json({
      error: "Stream fallido",
      message: err.message || "No se pudo iniciar el audio",
      code: 500
    });
  });

  ytdlp.on("close", code => {
    if (code !== 0) {
      console.error(`yt-dlp terminó con código ${code}`);
    }
  });
});

// 🩺 Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", ytReady: !!ytMusic, port: PORT });
});

// Middleware de errores centralizado
app.use((err, req, res, next) => {
  console.error("❌ Error:", err);
  res.status(err.statusCode || 500).json({
    error: "Error interno",
    message: err.message || "Algo salió mal",
    code: err.statusCode || 500
  });
});

// Arranque
(async () => {
  try {
    await getYTMusic();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();

