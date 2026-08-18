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
const ApplicationFieldSchema = require("./shared/applicationFieldSchema");

const VolunteerTaskSubmissionSchema = new mongoose.Schema(
  {
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", required: true },
    volunteerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    taskId: { type: String, required: true },
    // null pour une tâche ONCE ; sinon la date (minuit) de l'échéance DAILY/WEEKLY concernée.
    occurrenceDate: { type: Date, default: null },

    // Réponses au formulaire de preuve de la tâche (task.proofForm.fields),
    // clé = field.id — mêmes conventions que VolunteerApplication.responses.
    // Pour un champ IMAGE, la valeur est un tableau d'URLs Cloudinary.
    responses: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

    // Copie figée des champs de preuve TELS QU'ILS ÉTAIENT au moment de la
    // soumission (posée par submitTask) — décision utilisateur, 2026-08-18 :
    // sans ça, l'affichage d'une preuve se basait sur la définition ACTUELLE
    // de la tâche (task.proofForm.fields), donc une tâche renommée/modifiée/
    // supprimée après coup faisait disparaître des réponses pourtant
    // toujours en base (mauvaise correspondance de champs). Vide ([]) pour
    // les soumissions faites avant l'ajout de ce champ — listSubmissions
    // retombe alors sur l'ancien comportement (best-effort) pour celles-là.
    proofFieldsSnapshot: { type: [ApplicationFieldSchema], default: [] },

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
