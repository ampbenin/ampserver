/**
 * Modèle JobPosting – CMS AMP BENIN (DB2)
 * Remplace le tableau `jobsData` codé en dur dans JobsCarousel.jsx.
 * Pas de traduction : contenu opérationnel de courte durée de vie.
 */

const mongoose = require("mongoose");

const JobPostingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, default: "" },
    location: { type: String, default: "" },
    applyUrl: { type: String, required: true },
    // Lien de candidature à proprement parler (formulaire, email,
    // portail externe...) — distinct de applyUrl, qui malgré son nom sert
    // en réalité de lien vers le document/TDR (voir JobsCarousel.jsx,
    // boutons "Aperçu"/"Télécharger"). Optionnel : les offres déjà
    // publiées avant cet ajout n'en ont pas encore, le bouton "Postuler
    // ici" ne s'affiche alors simplement pas (voir JobsCarousel.jsx).
    applicationLink: { type: String, default: "" },
    deadline: { type: Date, default: null },
    order: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED"],
      default: "DRAFT",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = function getJobPostingModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (JobPosting)");
  }

  return formDB.models.CmsJobPosting || formDB.model("CmsJobPosting", JobPostingSchema);
};
