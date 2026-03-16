require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { Innertube } = require("youtubei.js");
const ytdl = require("ytdl-core");

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
        id: i.id || i.video_id, // compatibilidad con distintas estructuras
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

app.get("/stream/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || !ytdl.validateID(id)) {
      return res.status(400).json({ error: "ID inválido o requerido" });
    }

    const info = await ytdl.getInfo(id);
    const audioFormats = ytdl.filterFormats(info.formats, "audioonly");

    if (!audioFormats.length) {
      return res.status(410).json({
        error: "Stream no disponible",
        message: "No se pudo extraer audio de este video"
      });
    }

    const stream = ytdl(id, {
      filter: "audioonly",
      quality: "highestaudio"
    });

    stream.on("info", (info, format) => {
      res.setHeader("Content-Type", format.mimeType || "audio/webm");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Accept-Ranges", "bytes");
    });

    stream.pipe(res);

    stream.on("error", err => {
      console.error("❌ Error en stream:", err);
      res.status(500).json({
        error: "Stream fallido",
        message: err.message || "No se pudo iniciar el audio"
      });
    });
  } catch (err) {
    next(err);
  }
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
    message: err.message || "Algo salió mal"
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
