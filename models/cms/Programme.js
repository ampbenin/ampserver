/**
 * Modèle Programme – CMS AMP BENIN (DB2)
 * Remplace les 4 cartes codées en dur de programmes.astro.
 */

const mongoose = require("mongoose");

const ProgrammeSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    order: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED"],
      default: "DRAFT",
    },

    translations: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = function getProgrammeModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Programme)");
  }

  return formDB.models.CmsProgramme || formDB.model("CmsProgramme", ProgrammeSchema);
};
