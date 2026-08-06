/**
 * Modèle PartnerActivityLog — Suivi d'activité des comptes PARTENAIRE
 * (connexion + actions sur leur dashboard) pour que le staff sache qui
 * s'intéresse au programme et ce qu'il aime vérifier (voir
 * controllers/volunteerProgramPartnerController.js#getPartnerActivitySummary
 * / getPartnerActivityTimeline, utils/partnerActivityLogger.js).
 *
 * `programId` est null pour les actions au niveau du compte (connexion,
 * upload de logo) — pas rattachées à un programme précis. Vit sur
 * global.formDB, comme GestionAmpUser et VolunteerProgram.
 */

const mongoose = require("mongoose");

const PartnerActivityLogSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", required: true },
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", default: null },
    action: {
      type: String,
      enum: ["LOGIN", "OPEN_DASHBOARD", "VIEW_STATS", "VIEW_APPLICATIONS", "DOWNLOAD_REPORT", "UPLOAD_LOGO", "POST_COMMENT"],
      required: true,
    },
    // Ex. pour VIEW_APPLICATIONS : { search, status, dateFrom, dateTo, hasFieldFilters }
    // — le signal le plus direct pour savoir ce qu'un partenaire aime vérifier.
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Les deux vues d'activité trient/filtrent systématiquement par partenaire
// (+ éventuellement programme) puis par date décroissante.
PartnerActivityLogSchema.index({ partnerId: 1, createdAt: -1 });
PartnerActivityLogSchema.index({ partnerId: 1, programId: 1, createdAt: -1 });

module.exports = function getPartnerActivityLogModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (PartnerActivityLog)");
  }

  return formDB.models.PartnerActivityLog || formDB.model("PartnerActivityLog", PartnerActivityLogSchema);
};
