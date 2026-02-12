const express = require("express");
const cors = require("cors");
const YTMusic = require("ytmusic-api").default;

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  await ytmusic.initialize();
  console.log("YT Music listo 🎵");
})();


app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: "Falta parámetro q" });
    }

    const results = await ytmusic.search(q);

    res.json(results);
  } catch (err) {
    console.error("ERROR YT MUSIC:", err);
    res.status(500).json({ error: "Error interno en búsqueda" });
  }
});


app.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000 🚀");
});



