const express = require("express");
const cors = require("cors");
const YTMusicLib = require("ytmusic-api");
const YTMusic = YTMusicLib.default || YTMusicLib;

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  try {
    await ytmusic.initialize(); // 🔥 SIN opciones

    console.log("YT Music listo 🎶");
  } catch (err) {
    console.error("Error al iniciar YTMusic:", err);
  }
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);

    const results = await ytmusic.search(q);
    const songs = results.filter(r => r.type === "song");

    res.json(songs);
  } catch (err) {
    console.error("ERROR YT MÚSICA:", err);
    res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo 🚀 en puerto", PORT);
});



