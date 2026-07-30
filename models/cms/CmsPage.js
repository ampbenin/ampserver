/**
 * Modèle CmsPage – CMS AMP BENIN (DB2)
 * Un document par page "singleton" (accueil, à-propos, programmes...).
 * `zones` est volontairement libre (Mixed) car sa forme dépend de `pageKey`
 * (voir les composants Astro correspondants pour la forme attendue par page).
 */

const mongoose = require("mongoose");

const CmsPageSchema = new mongoose.Schema(
  {
    pageKey: {
      type: String,
      enum: ["home", "a-propos", "programmes"],
      required: true,
      unique: true,
    },

    zones: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

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

module.exports = function getCmsPageModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (CmsPage)");
  }

  return formDB.models.CmsPage || formDB.model("CmsPage", CmsPageSchema);
};
