// models/Newsletter.js
const mongoose = require("mongoose");

// ⚡ Définition du schéma Newsletter
const NewsletterSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    alert_type: { type: String, default: "journalier" },
  },
  { timestamps: true }
);

// ⚡ Fonction pour récupérer le modèle après que formDB soit initialisé
function getNewsletterModel() {
  if (!global.formDB) {
    throw new Error("formDB n'est pas encore initialisé !");
  }
  // Si le modèle existe déjà, on le récupère ; sinon on le crée
  return global.formDB.models.Newsletter || global.formDB.model("Newsletter", NewsletterSchema);
}

// ⚡ Exporter la fonction pour utilisation dans le controller
module.exports = getNewsletterModel;
