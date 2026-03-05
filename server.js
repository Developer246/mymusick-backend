const express    = require("express");
const cors       = require("cors");
const ytdl       = require("@distube/ytdl-core");
const { Innertube } = require("youtubei.js");
const { HttpsProxyAgent } = require("https-proxy-agent");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ===============================
   ESTADO GLOBAL
=============================== */
let ytMusic    = null;   // instancia reutilizable
let ytAgent    = null;
let proxyAgent = null;
let initPromise = null;  // evita inicializaciones paralelas

/* ===============================
   PARSEAR cookies.txt desde env
=============================== */
function parseCookiesTxt(content) {
  return content
    .split("\n")
    .filter(line => line.trim() && !line.startsWith("#"))
    .map(line => {
      const parts = line.split("\t");
      if (parts.length < 7) return null;
      return {
        domain:   parts[0],
        httpOnly: parts[1] === "TRUE",
        path:     parts[2],
        secure:   parts[3] === "TRUE",
        expires:  parseInt(parts[4]) || 0,
        name:     parts[5],
        value:    parts[6].trim(),
      };
    })
    .filter(Boolean);
}

/* ===============================
   CARGAR COOKIES Y PROXY
=============================== */
function loadAgent() {
  const raw   = process.env.YOUTUBE_COOKIES;
  const proxy = process.env.PROXY_URL;

  if (!raw) {
    console.warn("⚠️  YOUTUBE_COOKIES no definida");
    return null;
  }

  try {
    const cookies = parseCookiesTxt(raw);

    if (proxy) {
      proxyAgent = new HttpsProxyAgent(proxy);
      console.log("🌐 Proxy:", proxy.replace(/:\/\/.*@/, "://*****@"));
      const agent = ytdl.createProxyAgent({ uri: proxy }, cookies);
      console.log(`🍪 ${cookies.length} cookies + proxy`);
      return agent;
    }

    const agent = ytdl.createAgent(cookies);
    console.log(`🍪 ${cookies.length} cookies cargadas`);
    return agent;

  } catch (err) {
    console.error("❌ Error cargando agente:", err.message);
    return null;
  }
}

/* ===============================
   INICIALIZAR INNERTUBE
   Reutiliza la instancia existente.
   Si falla, la recrea automáticamente.
=============================== */
async function getYTMusic() {
  if (ytMusic) return ytMusic;

  // Si ya hay una inicialización en curso, esperar a que termine
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log("🔄 Inicializando Innertube...");
    const proxy = process.env.PROXY_URL;

    ytMusic = await Innertube.create({
      client_type: "WEB_REMIX",
      ...(proxy && proxyAgent ? {
        fetch: (input, init) => fetch(input, { ...init, agent: proxyAgent }),
      } : {}),
    });

    console.log("✅ Innertube listo");
    initPromise = null;
    return ytMusic;
  })();

  return initPromise;
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

    // Reutiliza instancia — si falla, la recrea una vez
    let yt;
    try {
      yt = await getYTMusic();
    } catch (err) {
      console.error("❌ Error obteniendo instancia:", err.message);
      return res.status(503).json({ error: "Servicio no disponible, intenta de nuevo" });
    }

    let search;
    try {
      search = await yt.music.search(q, { type: "song" });
    } catch (err) {
      // Si la instancia expiró, resetear y reintentar una vez
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
=============================== */
app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;

  if (!ytdl.validateID(id)) {
    return res.status(400).json({ error: "ID de video inválido" });
  }

  try {
    const url        = `https://www.youtube.com/watch?v=${id}`;
    const infoOpts   = ytAgent ? { agent: ytAgent } : {};
    const streamOpts = { quality: "highestaudio", filter: "audioonly", ...infoOpts };

    const info   = await ytdl.getInfo(url, infoOpts);
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter:  "audioonly",
    });

    if (!format) {
      return res.status(404).json({ error: "No hay formatos de audio disponibles" });
    }

    res.setHeader("Content-Type",  format.mimeType?.split(";")[0] || "audio/webm");
    res.setHeader("Cache-Control", "no-store");

    ytdl(url, streamOpts)
      .on("error", err => {
        console.error("❌ ytdl stream error:", err.message);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);

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
    status:        "ok",
    cookiesLoaded: !!ytAgent,
    proxyLoaded:   !!proxyAgent,
    ytReady:       !!ytMusic,
    port:          PORT,
  });
});

/* ===============================
   ARRANQUE
   Pre-calienta la instancia de Innertube
   para que la primera búsqueda sea rápida
=============================== */
(async () => {
  try {
    ytAgent = loadAgent();

    // Precalentar Innertube al arrancar → primera búsqueda instantánea
    await getYTMusic();

    app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();
