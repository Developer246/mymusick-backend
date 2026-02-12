const express = require("express");
const cors = require("cors");
const YTMusic = require("ytmusic-api").default;

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  await ytmusic.initialize({
    clientName: "WEB_REMIX",
    clientVersion: "1.20240101.01.00",
    cookies: "" 
  });

  console.log("YT Music listo 🎶");
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

app.listen(3000, () => {
  console.log("Servidor corriendo 🚀");
});

