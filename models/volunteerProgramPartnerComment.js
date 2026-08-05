/**
 * Modèle VolunteerProgramPartnerComment — Commentaires/suggestions d'un
 * partenaire sur un programme de volontariat qu'il suit. Visibles
 * uniquement par ADMIN/EDITOR (jamais les superviseurs), voir
 * controllers/volunteerProgramPartnerController.js#listPartnerComments.
 * Vit sur global.formDB, comme VolunteerProgram.
 */

const mongoose = require("mongoose");

const VolunteerProgramPartnerCommentSchema = new mongoose.Schema(
  {
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", required: true },
    text: { type: String, required: true, trim: true },

    // Réponse de l'équipe (ADMIN/EDITOR uniquement, voir replyToComment) — un
    // seul niveau de réponse par commentaire, pas un fil de discussion complet.
    reply: { type: String, default: null },
    repliedAt: { type: Date, default: null },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
  },
  { timestamps: true }
);

module.exports = function getVolunteerProgramPartnerCommentModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (VolunteerProgramPartnerComment)");
  }

  return formDB.models.VolunteerProgramPartnerComment
    || formDB.model("VolunteerProgramPartnerComment", VolunteerProgramPartnerCommentSchema);
};
