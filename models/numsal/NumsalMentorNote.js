/**
 * Modèle MentorNote – Plateforme NumSAL
 * Note de suivi qu'un tuteur laisse pour un de ses apprenants assignés.
 * Append-only en MVP : pas d'édition, seulement ajout + liste.
 */

const mongoose = require("mongoose");

const NumsalMentorNoteSchema = new mongoose.Schema(
  {
    tutorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalUser",
      required: true,
    },
    learnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalUser",
      required: true,
    },
    note: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = function getNumsalMentorNoteModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalMentorNote)");
  }

  return formDB.models.NumsalMentorNote || formDB.model("NumsalMentorNote", NumsalMentorNoteSchema);
};
