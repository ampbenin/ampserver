/**
 * Personne ayant rejoint une campagne de badge (formulaire demandé avant
 * l'affichage du badge). Sert au recensement et à l'envoi de rappels.
 */

const mongoose = require("mongoose");

const BadgeParticipantSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 150 },
    whatsapp: { type: String, default: "", trim: true, maxlength: 40 },
    countryCity: { type: String, default: "", trim: true, maxlength: 150 },
  },
  { timestamps: true }
);

module.exports = function getBadgeParticipantModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (BadgeParticipant)");
  }

  return formDB.models.CmsBadgeParticipant || formDB.model("CmsBadgeParticipant", BadgeParticipantSchema);
};
