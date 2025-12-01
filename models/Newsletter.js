// models/Newsletter.js
const mongoose = require("mongoose");

const NewsletterSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    alert_type: { type: String, default: "journalier" },
  },
  { timestamps: true }
);

// ⚠️ Retourner le model seulement quand la connexion formDB est disponible
function getNewsletterModel() {
  if (!global.formDB) {
    throw new Error("Connexion formDB non établie !");
  }

  return global.formDB.models.Newsletter || global.formDB.model("Newsletter", NewsletterSchema);
}

module.exports = getNewsletterModel;
