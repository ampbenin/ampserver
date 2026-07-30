/**
 * Modèle Action – CMS AMP BENIN (DB2)
 * Remplace le tableau `actions` codé en dur dans NosActions.jsx.
 */

const mongoose = require("mongoose");

const ActionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    media: { type: String, default: "" },
    type: { type: String, enum: ["image", "video"], default: "image" },
    // Libre (pas d'enum strict) : une nouvelle thématique reste affichable
    // même sans mise à jour de code, avec une couleur de badge par défaut.
    theme: { type: String, default: "" },
    year: { type: Number, default: null },
    reportUrl: { type: String, default: "" },
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

module.exports = function getActionCmsModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (Action CMS)");
  }

  return formDB.models.CmsAction || formDB.model("CmsAction", ActionSchema);
};
