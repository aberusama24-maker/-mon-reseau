const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const app = express();

app.use(express.json({ limit: "300kb" }));
app.use(express.static("public"));

const FICHIER = "donnees.json";
const AVATARS = ["🦊", "🐼", "🦁", "🐸", "🐙", "🦄", "🐯", "🐵"];
const PREFIXE = "data:image/jpeg;base64,";

let publications = [];
let profils = {};

// Au démarrage : on relit le fichier s'il existe
if (fs.existsSync(FICHIER)) {
  const data = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
  if (Array.isArray(data)) {
    publications = data; // ancien format
  } else {
    publications = data.publications || [];
    profils = data.profils || {};
  }
}
// Les anciens profils reçoivent un identifiant public et un numéro de photo
for (const id in profils) {
  if (!profils[id].publicId) profils[id].publicId = crypto.randomUUID();
  if (!profils[id].photoVersion) profils[id].photoVersion = 0;
  if (!profils[id].photo) profils[id].photo = null;
}
let prochainId = publications.reduce((max, p) => Math.max(max, p.id), 0) + 1;

function sauvegarder() {
  fs.writeFileSync(FICHIER, JSON.stringify({ publications, profils }, null, 2));
}

// Nettoie et limite les champs d'un profil
function nettoyerProfil(corps = {}) {
  const pseudo = String(corps.pseudo || "").trim().slice(0, 20);
  const bio = String(corps.bio || "").trim().slice(0, 100);
  const avatar = AVATARS.includes(corps.avatar) ? corps.avatar : AVATARS[0];
  return { pseudo, bio, avatar };
}

// Ce qu'on a le droit de montrer à tout le monde (jamais la clé secrète)
function vuePublique(p) {
  return {
    pseudo: p.pseudo,
    bio: p.bio,
    avatar: p.avatar,
    photoUrl: p.photo ? "/api/photos/" + p.publicId + "?v=" + p.photoVersion : null
  };
}

function enrichir(pub) {
  const profil = profils[pub.auteurId];
  const vue = profil
    ? vuePublique(profil)
    : { pseudo: "Membre", bio: "", avatar: AVATARS[0], photoUrl: null };
  return { id: pub.id, texte: pub.texte, likes: pub.likes, ...vue };
}

// ----- Profils -----

app.post("/api/profils", (req, res) => {
  const id = crypto.randomUUID();
  const base = nettoyerProfil(req.body);
  profils[id] = {
    pseudo: base.pseudo || "Membre " + (Object.keys(profils).length + 1),
    bio: base.bio,
    avatar: base.avatar,
    publicId: crypto.randomUUID(),
    photo: null,
    photoVersion: 0
  };
  sauvegarder();
  res.status(201).json({ id, ...vuePublique(profils[id]) });
});

app.get("/api/profils/:id", (req, res) => {
  const profil = profils[req.params.id];
  if (!profil) {
    return res.status(404).json({ erreur: "Introuvable" });
  }
  res.json({ id: req.params.id, ...vuePublique(profil) });
});

app.put("/api/profils/:id", (req, res) => {
  const profil = profils[req.params.id];
  if (!profil) {
    return res.status(404).json({ erreur: "Introuvable" });
  }
  const nouveau = nettoyerProfil(req.body);
  if (nouveau.pseudo === "") {
    return res.status(400).json({ erreur: "Pseudo vide" });
  }
  Object.assign(profil, nouveau);
  sauvegarder();
  res.json({ id: req.params.id, ...vuePublique(profil) });
});

// ----- Photos -----

app.put("/api/profils/:id/photo", (req, res) => {
  const profil = profils[req.params.id];
  if (!profil) {
    return res.status(404).json({ erreur: "Introuvable" });
  }
  const photo = String((req.body && req.body.photo) || "");
  if (!photo.startsWith(PREFIXE) || photo.length > 150000) {
    return res.status(400).json({ erreur: "Photo invalide ou trop lourde" });
  }
  // Un vrai JPEG commence par les octets FF D8 FF
  const octets = Buffer.from(photo.slice(PREFIXE.length), "base64");
  if (octets.length < 3 || octets[0] !== 0xff || octets[1] !== 0xd8 || octets[2] !== 0xff) {
    return res.status(400).json({ erreur: "Ce n'est pas une image JPEG" });
  }
  profil.photo = photo;
  profil.photoVersion++;
  sauvegarder();
  res.json({ id: req.params.id, ...vuePublique(profil) });
});

app.delete("/api/profils/:id/photo", (req, res) => {
  const profil = profils[req.params.id];
  if (!profil) {
    return res.status(404).json({ erreur: "Introuvable" });
  }
  profil.photo = null;
  profil.photoVersion++;
  sauvegarder();
  res.json({ id: req.params.id, ...vuePublique(profil) });
});

app.get("/api/photos/:publicId", (req, res) => {
  const profil = Object.values(profils).find(p => p.publicId === req.params.publicId);
  if (!profil || !profil.photo) {
    return res.status(404).end();
  }
  const octets = Buffer.from(profil.photo.slice(PREFIXE.length), "base64");
  res.set({
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=31536000",
    "X-Content-Type-Options": "nosniff"
  });
  res.send(octets);
});

// ----- Publications -----

app.get("/api/publications", (req, res) => {
  res.json(publications.map(enrichir));
});

app.post("/api/publications", (req, res) => {
  const texte = String(req.body.texte || "").trim().slice(0, 280);
  if (texte === "") {
    return res.status(400).json({ erreur: "Texte vide" });
  }
  if (!profils[req.body.profilId]) {
    return res.status(400).json({ erreur: "Profil inconnu" });
  }
  const pub = { id: prochainId++, texte, likes: 0, auteurId: req.body.profilId };
  publications.push(pub);
  sauvegarder();
  res.status(201).json(enrichir(pub));
});

app.post("/api/publications/:id/aimer", (req, res) => {
  const pub = publications.find(p => p.id === Number(req.params.id));
  if (!pub) {
    return res.status(404).json({ erreur: "Introuvable" });
  }
  pub.likes++;
  sauvegarder();
  res.json(enrichir(pub));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur lancé sur le port " + PORT);
});