const express = require("express");
const cors = require("cors");
const YTMusic = require("ytmusic-api").default;

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  try {
    await ytmusic.initialize({
      clientName: "WEB_REMIX",
      clientVersion: "1.20240101.01.00"
    });
    console.log("YTMusic listo 🎶");
  } catch (e) {
    console.error("ERROR YT MUSIC:", e);
  }
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json([]);

    const results = await ytmusic.search(q);
    const songs = results.filter(r => r.type === "song");

    res.json(songs);
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en", PORT));
