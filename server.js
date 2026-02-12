const express = require("express");
const cors = require("cors");
const YTMusic = require("ytmusic-api");

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  try {
    await ytmusic.initialize();
    console.log("YT Music listo");
  } catch (e) {
    console.error("Error inicializando YTMusic", e);
  }
})();

app.get("/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);

  try {
    const results = await ytmusic.search(q, "song");
    res.json(results.slice(0, 5));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "YT Music error" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor activo");
});


