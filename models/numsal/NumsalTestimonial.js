/**
 * Modèle Testimonial – Plateforme NumSAL
 * Un avis soumis publiquement ("Donner votre avis" sur la page d'accueil),
 * modéré par l'ADMIN avant publication. `contact` n'est jamais exposé par
 * l'API publique — uniquement visible par l'admin, pour le recontacter en
 * cas de doute avant publication.
 */

const mongoose = require("mongoose");

const NumsalTestimonialSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    photoUrl: { type: String, default: "" },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["PENDING", "PUBLISHED", "REJECTED"],
      default: "PENDING",
    },
    // Ordre d'affichage parmi les avis PUBLISHED uniquement.
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = function getNumsalTestimonialModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalTestimonial)");
  }

  return formDB.models.NumsalTestimonial || formDB.model("NumsalTestimonial", NumsalTestimonialSchema);
};
