/**
 * Modèle JobApplication — Candidatures de recrutement (offres JobPosting)
 * Mirror de volunteerApplication.js, adapté au pipeline de recrutement
 * (décision utilisateur, 2026-09-15) : RECEIVED (reçue, à trier) →
 * UNDER_REVIEW (en étude) → RETAINED/REJECTED (décision finale). Une
 * candidature RETAINED crée/relie une fiche Personnel (voir
 * controllers/jobApplicationController.js#retainApplication).
 *
 * Étape PENDING_VALIDATION ajoutée le 2026-09-30 : quand un compte non-ADMIN
 * (affecté via staffAccess avec canReviewApplications) retient une
 * candidature, elle passe par cette étape intermédiaire au lieu de RETAINED
 * directement — l'email au candidat et la création de la fiche Personnel
 * n'ont lieu qu'après validation explicite par un ADMIN
 * (controllers/jobApplicationController.js#validateRetain). Un ADMIN qui
 * retient lui-même une candidature reste direct (décision utilisateur) :
 * cette étape ne concerne que les comptes non-ADMIN.
 *
 * Volontairement plus simple que VolunteerApplication : pas d'accessMode
 * OPEN (une offre d'emploi n'a pas d'admission automatique), pas de
 * groupes/bulk (non demandés pour ce chantier).
 */

const mongoose = require("mongoose");

const JobApplicationSchema = new mongoose.Schema(
  {
    jobPostingId: { type: mongoose.Schema.Types.ObjectId, ref: "CmsJobPosting", required: true },

    applicantFirstName: { type: String, required: true, trim: true },
    applicantLastName: { type: String, required: true, trim: true },
    applicantEmail: { type: String, required: true, trim: true, lowercase: true },
    applicantPhone: { type: String, default: "" },

    // Réponses aux champs personnalisés du formulaire de l'offre, clé = field.id.
    responses: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ["RECEIVED", "UNDER_REVIEW", "PENDING_VALIDATION", "RETAINED", "REJECTED"],
      default: "RECEIVED",
    },

    // Note interne libre pour l'étape "étudier" — jamais envoyée au
    // candidat, visible seulement dans le panneau admin.
    staffNotes: { type: String, default: "" },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
    reviewedAt: { type: Date, default: null },

    // Rempli seulement quand status === "RETAINED" — voir retainApplication.
    personnelId: { type: mongoose.Schema.Types.ObjectId, ref: "Personnel", default: null },

    // Renseignés quand un non-ADMIN propose la rétention (status passe à
    // PENDING_VALIDATION) — repris tels quels par validateRetain à la
    // validation ADMIN, sauf si l'ADMIN les précise explicitement dans son
    // body de validation.
    proposedCategory: { type: String, default: "" },
    proposedNotes: { type: String, default: "" },
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
    proposedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Une seule candidature par offre et par email.
JobApplicationSchema.index({ jobPostingId: 1, applicantEmail: 1 }, { unique: true });

module.exports = function getJobApplicationModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (JobApplication)");
  }

  return formDB.models.JobApplication || formDB.model("JobApplication", JobApplicationSchema);
};
