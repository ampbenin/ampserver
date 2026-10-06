/**
 * Modèle BadgeCampaign – CMS AMP BENIN (DB2)
 * Campagne de badge en ligne : un gabarit image (uploadé par l'admin) sur
 * lequel le visiteur place sa photo et son nom. Les zones sont exprimées en
 * pourcentages (0-100) de la taille du gabarit, pour rester valables quelle
 * que soit la résolution d'affichage.
 */

const mongoose = require("mongoose");

const ZoneSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true, min: 0, max: 100 },
    y: { type: Number, required: true, min: 0, max: 100 },
    w: { type: Number, required: true, min: 0, max: 100 },
    h: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const BadgeCampaignSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    templateUrl: { type: String, required: true },
    templatePublicId: { type: String, default: null },

    photoZone: { type: ZoneSchema, required: true },
    nameZone: { type: ZoneSchema, required: true },

    bannerUrl: { type: String, default: null },
    bannerPublicId: { type: String, default: null },

    partners: [
      {
        _id: false,
        name: { type: String, required: true, trim: true },
        logoUrl: { type: String, default: null },
        websiteUrl: { type: String, default: null },
      },
    ],

    // Couleur d'accent de la page publique (titres, bouton) et couleur du
    // nom imprimé sur le badge — propres à chaque campagne.
    nameAlign: { type: String, enum: ["left", "center", "right"], default: "center" },

    // Réglages par défaut du cadre de la photo, que le visiteur peut changer.
    frameShape: { type: String, enum: ["square", "circle"], default: "square" },
    frameStyle: { type: String, enum: ["none", "simple", "double", "or", "argent", "ombre"], default: "none" },
    frameColor: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: "#1B4332" },

    colors: {
      accent: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: "#1B4332" },
      nameText: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: "#FFFFFF" },
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

module.exports = function getBadgeCampaignModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (BadgeCampaign)");
  }

  return formDB.models.CmsBadgeCampaign || formDB.model("CmsBadgeCampaign", BadgeCampaignSchema);
};
