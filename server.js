const express = require("express");
const cors = require("cors");
const YTMusic = require("ytmusic-api").default;

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  await ytmusic.initialize();
  console.log("YT Music API lista 🎶");
})();

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);

    const results = await ytmusic.search(q);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error buscando música" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Servidor corriendo en puerto", PORT)
);


