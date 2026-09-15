/**
 * Modèle Personnel — Base du personnel AMP BÉNIN
 * Alimentée automatiquement quand une candidature de recrutement (voir
 * models/jobApplication.js) est retenue (controllers/jobApplicationController.js#retainApplication),
 * mais aussi utilisable en ajout manuel (personnel déjà en poste, non issu
 * d'un recrutement — sourceJobPostingId/sourceApplicationId restent alors null).
 *
 * `category` est un texte libre (décision utilisateur, 2026-09-15 : pas de
 * liste figée en dur) — voir controllers/personnelController.js#listCategories
 * pour l'autocomplete des catégories déjà utilisées.
 */

const mongoose = require("mongoose");

const PersonnelSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: "" },

    category: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["ACTIF", "INACTIF"],
      default: "ACTIF",
    },

    hiredAt: { type: Date, default: Date.now },
    notes: { type: String, default: "" },

    // Traçabilité — nuls pour un membre ajouté manuellement.
    sourceJobPostingId: { type: mongoose.Schema.Types.ObjectId, ref: "CmsJobPosting", default: null },
    sourceApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: "JobApplication", default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
  },
  { timestamps: true }
);

module.exports = function getPersonnelModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Personnel)");
  }

  return formDB.models.Personnel || formDB.model("Personnel", PersonnelSchema);
};
