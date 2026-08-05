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
