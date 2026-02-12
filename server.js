const express = require("express");
const cors = require("cors");
const YTMusic = require("ytmusic-api");

const app = express();
app.use(cors());

const ytmusic = new YTMusic();

(async () => {
  await ytmusic.initialize();
  console.log("YT Music listo 🎵");
})();


app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;       

    if (!query) {                    
      return res.json([]);
    }

    const results = await ytmusic.search(query, "song"); 

    const songs = results.map(song => ({
      title: song.name,              
      artist: song.artist.name,      
      videoId: song.videoId,         
      thumbnail: song.thumbnails[0]?.url 
    }));

    res.json(songs);                 
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error buscando música" });
  }
});

app.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000 🚀");
});



