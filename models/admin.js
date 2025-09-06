const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true }, // identifiant
  password: { type: String, required: true }, // hashé (bcrypt)
  role: {
    type: String,
    enum: ["CadreA", "CadreB", "CadreC"], // rôles possibles
    required: true,
  },
  missions: [{ type: String }], // ex: attribuées à CadreB
});

// ✅ éviter de redéfinir le modèle si déjà existant
module.exports = mongoose.models.Admin || mongoose.model("Admin", AdminSchema);
