// backend/utils/cloudinary.js
require("dotenv").config(); // <-- charger les variables d'environnement

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  secure: true, // toujours utiliser HTTPS
  // le SDK utilisera automatiquement CLOUDINARY_URL si définie
});

module.exports = cloudinary;
