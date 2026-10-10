const express = require("express");
const app = express();

app.use(express.json());
app.use(express.static("public"));

let publications = [];
let prochainId = 1;

app.get("/api/publications", (req, res) => {
  res.json(publications);
});

app.post("/api/publications", (req, res) => {
  const texte = (req.body.texte || "").trim();
  if (texte === "") {
    return res.status(400).json({ erreur: "Texte vide" });
  }
  const pub = { id: prochainId++, texte: texte, likes: 0 };
  publications.push(pub);
  res.status(201).json(pub);
});

app.post("/api/publications/:id/aimer", (req, res) => {
  const pub = publications.find(p => p.id === Number(req.params.id));
  if (!pub) {
    return res.status(404).json({ erreur: "Introuvable" });
  }
  pub.likes++;
  res.json(pub);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur lancé sur le port " + PORT);
});