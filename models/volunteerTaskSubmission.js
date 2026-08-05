/**
 * Modèle VolunteerTaskSubmission — Suivi des tâches de mission
 * Une soumission = la preuve fournie par un volontaire pour UNE occurrence
 * d'UNE tâche de VolunteerProgram.tasks[] (occurrenceDate null pour une
 * tâche ONCE, une date précise pour DAILY/WEEKLY). Vit sur global.formDB,
 * comme VolunteerProgram.
 *
 * `volunteerId` référence Volunteer, qui vit sur la connexion par défaut —
 * référence inter-connexion, même limite déjà acceptée partout ailleurs
 * dans ce chantier (VolunteerApplication.volunteerId, etc.) : pas de
 * .populate() possible, résolution manuelle si besoin.
 */

const mongoose = require("mongoose");

const VolunteerTaskSubmissionSchema = new mongoose.Schema(
  {
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", required: true },
    volunteerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    taskId: { type: String, required: true },
    // null pour une tâche ONCE ; sinon la date (minuit) de l'échéance DAILY/WEEKLY concernée.
    occurrenceDate: { type: Date, default: null },

    proofText: { type: String, default: "" },
    proofUrl: { type: String, default: "" },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    submittedAt: { type: Date, default: Date.now },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" },
  },
  { timestamps: true }
);

// Une seule soumission par (programme, volontaire, tâche, occurrence) —
// une resoumission (après rejet, ou avant l'échéance) met à jour ce même
// document plutôt que d'en créer un nouveau (voir submitTask, upsert).
VolunteerTaskSubmissionSchema.index(
  { programId: 1, volunteerId: 1, taskId: 1, occurrenceDate: 1 },
  { unique: true }
);

module.exports = function getVolunteerTaskSubmissionModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (VolunteerTaskSubmission)");
  }

  return formDB.models.VolunteerTaskSubmission || formDB.model("VolunteerTaskSubmission", VolunteerTaskSubmissionSchema);
};
