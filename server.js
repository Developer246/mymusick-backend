const express    = require("express");
const cors       = require("cors");
const { Innertube } = require("youtubei.js");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ===============================
   INSTANCIAS INVIDIOUS PÚBLICAS
   Se rotan si una falla
=============================== */
const INVIDIOUS_INSTANCES = [
  "https://iv.datura.network",
  "https://invidious.privacydev.net",
  "https://yt.cdaut.de",
  "https://invidious.nerdvpn.de",
  "https://invidious.io.lol",
];

let currentInstance = 0;

function getNextInstance() {
  const instance = INVIDIOUS_INSTANCES[currentInstance];
  currentInstance = (currentInstance + 1) % INVIDIOUS_INSTANCES.length;
  return instance;
}

/* ===============================
   ESTADO GLOBAL
=============================== */
let ytMusic     = null;
let initPromise = null;

/* ===============================
   INICIALIZAR INNERTUBE
=============================== */
async function getYTMusic() {
  if (ytMusic) return ytMusic;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log("🔄 Inicializando Innertube...");
    ytMusic     = await Innertube.create({ client_type: "WEB_REMIX" });
    initPromise = null;
    console.log("✅ Innertube listo");
    return ytMusic;
  })();

  return initPromise;
}

/* ===============================
   OBTENER URL DE AUDIO VÍA INVIDIOUS
   Rota instancias si una falla
=============================== */
async function getAudioFromInvidious(videoId) {
  const tried = new Set();

  while (tried.size < INVIDIOUS_INSTANCES.length) {
    const instance = getNextInstance();
    if (tried.has(instance)) continue;
    tried.add(instance);

    try {
      const url  = `${instance}/api/v1/videos/${videoId}`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!res.ok) {
        console.warn(`⚠️  ${instance} respondió ${res.status}`);
        continue;
      }

      const data = await res.json();

      // Filtrar solo formatos de audio, ordenar por bitrate
      const audioFormats = (data.adaptiveFormats || [])
        .filter(f => f.type?.includes("audio") && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (!audioFormats.length) {
        console.warn(`⚠️  ${instance} sin formatos de audio`);
        continue;
      }

      const best = audioFormats[0];
      console.log(`✅ Audio desde ${instance} — ${best.type?.split(";")[0]} @ ${best.bitrate}bps`);

      return {
        url:      best.url,
        mimeType: best.type?.split(";")[0] || "audio/webm",
      };

    } catch (err) {
      console.warn(`⚠️  ${instance} error: ${err.message}`);
    }
  }

  throw new Error("Todas las instancias de Invidious fallaron");
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
    } catch (err) {
      return res.status(503).json({ error: "Servicio no disponible, intenta de nuevo" });
    }

    let search;
    try {
      search = await yt.music.search(q, { type: "song" });
    } catch (err) {
      console.warn("⚠️  Instancia inválida, reiniciando...");
      ytMusic = null;
      yt      = await getYTMusic();
      search  = await yt.music.search(q, { type: "song" });
    }

    const section = search.contents?.find(s => Array.isArray(s?.contents));
    if (!section) return res.json([]);

    const songs = section.contents
      .filter(item => item?.videoId || item?.id)
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
   Obtiene URL de audio vía Invidious
   y hace redirect directo al cliente
=============================== */
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;

  if (!id?.match(/^[\w-]{5,20}$/)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const { url, mimeType } = await getAudioFromInvidious(id);

    // Redirect directo — el navegador descarga el audio sin pasar por el servidor
    res.redirect(302, url);

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
  res.json({
    status:   "ok",
    ytReady:  !!ytMusic,
    port:     PORT,
  });
});

/* ===============================
   ARRANQUE
=============================== */
(async () => {
  try {
    await getYTMusic();
    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();
