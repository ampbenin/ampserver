/**
 * Demande de partenariat envoyée depuis la page publique d'une campagne de
 * badge. Acceptée par l'admin, elle ajoute le partenaire à la campagne.
 */

const mongoose = require("mongoose");

const BadgePartnerRequestSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    structureName: { type: String, required: true, trim: true, maxlength: 150 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 150 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    actionDescription: { type: String, required: true, trim: true, maxlength: 2000 },
    contribution: { type: String, required: true, trim: true, maxlength: 2000 },
    logoUrl: { type: String, default: null },
    logoPublicId: { type: String, default: null },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = function getBadgePartnerRequestModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (BadgePartnerRequest)");
  }

  return formDB.models.CmsBadgePartnerRequest || formDB.model("CmsBadgePartnerRequest", BadgePartnerRequestSchema);
};
