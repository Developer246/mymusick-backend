const express      = require("express");
const cors         = require("cors");
const { spawn }    = require("child_process");
const { Innertube } = require("youtubei.js");
const fs           = require("fs");
const path         = require("path");
const https        = require("https");

const app      = express();
const PORT     = process.env.PORT || 3000;
const YTDLP    = path.join("/tmp", "yt-dlp_linux");
const COOKIES  = path.join("/tmp", "cookies.txt");

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(new Error(`Origen no permitido: ${origin}`));
  }
}));
app.use(express.json());

let ytMusic     = null;
let initPromise = null;
let oauthTokens = null;

function loadOAuthTokens() {
  const raw = process.env.YOUTUBE_OAUTH;
  if (!raw) return null;
  try {
    const tokens = JSON.parse(raw);
    console.log("🔑 OAuth tokens cargados desde YOUTUBE_OAUTH");
    return tokens;
  } catch {
    console.warn("⚠️ YOUTUBE_OAUTH inválido — debe ser JSON");
    return null;
  }
}

function downloadYtDlp() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(YTDLP)) {
      console.log("✅ yt-dlp ya existe");
      return resolve();
    }
    console.log("⬇️  Descargando yt-dlp...");
    const file = fs.createWriteStream(YTDLP);
    const request = (url) => {
      https.get(url, res => {
        if (res.statusCode === 301 || res.statusCode === 302) return request(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        res.pipe(file);
        file.on("finish", () => file.close(() => {
          fs.chmodSync(YTDLP, 0o755);
          console.log("✅ yt-dlp listo");
          resolve();
        }));
      }).on("error", err => { fs.unlink(YTDLP, () => {}); reject(err); });
    };
    request("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux");
  });
}

function writeCookies() {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) { console.warn("⚠️ YOUTUBE_COOKIES no definida"); return false; }
  try {
    const content = raw.replace(/\\n/g, "\n");
    fs.writeFileSync(COOKIES, content, "utf-8");
    const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#"));
    console.log(`🍪 ${lines.length} cookies escritas`);
    return true;
  } catch (err) {
    console.error("❌ Error escribiendo cookies:", err.message);
    return false;
  }
}

async function getYTMusic() {
  if (ytMusic) return ytMusic;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const yt = await Innertube.create({ client_type: "WEB_REMIX" });

    if (oauthTokens) {
      try {
        yt.session.oauth.setupCredentials(oauthTokens);
        yt.session.oauth.on("update-credentials", ({ credentials }) => {
          oauthTokens = credentials;
          console.log("🔄 OAuth renovado — actualiza YOUTUBE_OAUTH con:");
          console.log(JSON.stringify(credentials));
        });
        await yt.session.oauth.refreshIfNeeded();
        console.log("✅ Innertube listo con OAuth");
      } catch (e) {
        console.warn("⚠️ OAuth falló, usando sin auth:", e.message);
      }
    } else {
      console.log("✅ Innertube listo (sin OAuth)");
    }

    ytMusic     = yt;
    initPromise = null;
    return ytMusic;
  })();

  return initPromise;
}

function getAudioUrl(videoId) {
  return new Promise((resolve, reject) => {
    const args = ["--no-playlist", "--no-warnings", "-f", "bestaudio/best", "--get-url"];

    const accessToken = oauthTokens?.access_token;
    if (accessToken) {
      args.push("--username", "oauth2", "--password", "");
      args.push("--add-header", `Authorization:Bearer ${accessToken}`);
      console.log("🔑 yt-dlp usando OAuth token");
    } else if (fs.existsSync(COOKIES)) {
      args.push("--cookies", COOKIES);
      console.log("🍪 yt-dlp usando cookies");
    }

    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const proc = spawn(YTDLP, args);
    let url = "", errOut = "";
    proc.stdout.on("data", d => { url    += d.toString(); });
    proc.stderr.on("data", d => { errOut += d.toString(); });
    proc.on("close", code => {
      url = url.trim();
      if (code === 0 && url) resolve(url);
      else reject(new Error(errOut.trim() || `yt-dlp código ${code}`));
    });
    proc.on("error", e => reject(new Error(`yt-dlp error: ${e.message}`)));
  });
}

function getBestThumbnail(thumbnails = []) {
  return thumbnails.reduce((best, thumb) => {
    const size     = (thumb.width  || 0) * (thumb.height || 0);
    const bestSize = (best?.width  || 0) * (best?.height || 0);
    return size > bestSize ? thumb : best;
  }, null);
}

function toHDThumbnail(url = "") { return url.replace(/w\d+-h\d+/, "w1080-h1080"); }

function durationToSeconds(text = "") {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

app.get("/auth", async (req, res) => {
  try {
    const yt = await Innertube.create({ client_type: "WEB_REMIX" });
    let responded = false;

    yt.session.on("auth-pending", (data) => {
      console.log(`\n🔑 Ve a: ${data.verification_url}`);
      console.log(`🔑 Código: ${data.user_code}\n`);
      if (!responded) {
        responded = true;
        res.json({
          message: "Abre esta URL e ingresa el código",
          url:     data.verification_url,
          code:    data.user_code
        });
      }
    });

    yt.session.on("auth", ({ credentials }) => {
      oauthTokens = credentials;
      ytMusic     = null;
      console.log("\n✅ OAuth completado. Guarda en YOUTUBE_OAUTH:");
      console.log(JSON.stringify(credentials));
    });

    yt.session.on("update-credentials", ({ credentials }) => {
      oauthTokens = credentials;
      console.log("🔄 Tokens renovados:", JSON.stringify(credentials));
    });

    await yt.session.signIn();

  } catch (err) {
    console.error("❌ /auth error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/auth/status", (req, res) => {
  res.json({
    authenticated:    !!oauthTokens,
    has_access_token: !!(oauthTokens?.access_token),
    expires:          oauthTokens?.expiry_date || null
  });
});

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);

    const t0 = Date.now();
    let yt;
    try { yt = await getYTMusic(); }
    catch { return res.status(503).json({ error: "Servicio no disponible" }); }

    let search;
    try { search = await yt.music.search(q, { type: "song" }); }
    catch {
      ytMusic = null;
      yt      = await getYTMusic();
      search  = await yt.music.search(q, { type: "song" });
    }

    let items = [];
    for (const section of (search.contents || [])) {
      if (Array.isArray(section?.contents)) {
        const found = section.contents.filter(i => i?.videoId || i?.id);
        if (found.length) { items = found; break; }
        for (const sub of section.contents) {
          if (Array.isArray(sub?.contents)) {
            const found2 = sub.contents.filter(i => i?.videoId || i?.id);
            if (found2.length) { items = found2; break; }
          }
        }
      }
      if (items.length) break;
    }

    if (!items.length) return res.json([]);

    const songs = items.slice(0, 10).map(item => {
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

app.get("/stream/:id", async (req, res) => {
  const { id } = req.params;
  if (!id?.match(/^[\w-]{5,20}$/)) return res.status(400).json({ error: "ID inválido" });

  try {
    console.log(`🎵 Stream: ${id}`);

    let audioUrl = null;

    // Intentar con youtubei.js primero (funciona con OAuth en datacenter)
    try {
      const yt = await getYTMusic();
      let info;
      try {
        info = await yt.music.getInfo(id);
      } catch {
        info = await yt.getInfo(id);
      }
      const format = info.chooseFormat({ type: "audio", quality: "best" });
      if (format?.url) {
        audioUrl = format.url;
        console.log("✅ URL obtenida via youtubei.js");
      }
    } catch (e) {
      console.warn("⚠️ youtubei.js falló, intentando yt-dlp:", e.message);
    }

    // Fallback a yt-dlp
    if (!audioUrl) {
      audioUrl = await getAudioUrl(id);
      console.log("✅ URL obtenida via yt-dlp");
    }

    const upstream = await fetch(audioUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)",
        "Range": req.headers.range || "bytes=0-",
      }
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
    }

    const ct = upstream.headers.get("content-type");
    const cl = upstream.headers.get("content-length");
    const cr = upstream.headers.get("content-range");

    if (ct) res.setHeader("Content-Type", ct.split(";")[0]);
    if (cl) res.setHeader("Content-Length", cl);
    if (cr) res.setHeader("Content-Range", cr);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.status(upstream.status === 206 ? 206 : 200);

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      res.write(value);
    }

  } catch (err) {
    console.error("❌ /stream error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Error obteniendo audio", message: err.message });
  }
});

app.get("/health", (req, res) => {
  const cookieLines = fs.existsSync(COOKIES)
    ? fs.readFileSync(COOKIES, "utf-8").split("\n").filter(l => l.trim() && !l.startsWith("#")).length
    : 0;
  res.json({
    status:       "ok",
    ytReady:      !!ytMusic,
    oauthLoaded:  !!oauthTokens,
    ytdlpExists:  fs.existsSync(YTDLP),
    cookiesExist: fs.existsSync(COOKIES),
    cookieLines,
    port:         PORT,
  });
});

(async () => {
  try {
    oauthTokens = loadOAuthTokens();
    writeCookies();
    await downloadYtDlp();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor en puerto ${PORT}`);
      getYTMusic().catch(err => console.warn("⚠️ Innertube init falló:", err.message));
    });
  } catch (err) {
    console.error("❌ Error arrancando:", err);
    process.exit(1);
  }
})();
