const express = require("express");
const cors = require("cors");
const { Innertube } = require("youtubei.js");

const app = express();
app.use(cors());

let yt;

async function initYouTube() {
  yt = await Innertube.create({ client_type: "ANDROID" });
  console.log("🎵 YouTube Music listo");
}

app.get("/search", async (req, res) => {
  try {
    if (!yt) {
      return res.status(503).json({ error: "YouTube aún no está listo" });
    }

    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: "Falta el parámetro ?q=" });
    }

    const result = await yt.music.search(q, { type: "song" });

    const section = result.contents?.find(c => c.type === "musicShelfRenderer");
    const items = section?.contents || [];

const canciones = items.map(song => ({
  id: song.videoId || song.playlistId,
  titulo: song.title?.runs?.[0]?.text,
  artista: song.longBylineText?.runs?.map(r => r.text).join(", "),
  duracion: song.thumbnailOverlays?.[0]?.text?.simpleText,
  thumbnail: song.thumbnail?.thumbnails?.[0]?.url
}));


app.listen(3000, async () => {
  await initYouTube();
  console.log("🚀 Servidor corriendo en puerto 3000");
});



