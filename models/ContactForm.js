// models/ContactForm.js
const mongoose = require("mongoose");

const ContactFormSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  location: { type: String, required: true },
  whatsapp: { type: String },
  destination: { type: String, required: true },
  institution: { type: String },
  message: { type: String, required: true },
}, { timestamps: true });

// ⚡ Fonction pour récupérer le modèle après que formDB soit initialisé
function getContactFormModel() {
  if (!global.formDB) {
    throw new Error("formDB n'est pas encore initialisé !");
  }
  return global.formDB.models.ContactForm || global.formDB.model("ContactForm", ContactFormSchema);
}

module.exports = getContactFormModel;
