/**
 * Modèle VolunteerApplication — Candidatures de volontariat AMP Bénin
 * Remplace/absorbe l'ancien modèle VolunteerForm. `programId` nul = une
 * candidature "spontanée" (aucun programme précis choisi) — voir
 * VolunteerFormTemplate.isSpontaneousDefault pour le formulaire utilisé
 * dans ce cas. Vit sur global.formDB, comme VolunteerProgram.
 *
 * Champs verrouillés `applicantFirstName`/`applicantLastName` (séparés,
 * contrairement au `applicantName` unique de NumSAL) pour correspondre
 * directement à `Volunteer.nom`/`Volunteer.prenom` sans devoir deviner où
 * couper un nom complet lors de l'admission.
 */

const mongoose = require("mongoose");

const VolunteerApplicationSchema = new mongoose.Schema(
  {
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", default: null },

    applicantFirstName: { type: String, required: true, trim: true },
    applicantLastName: { type: String, required: true, trim: true },
    applicantEmail: { type: String, required: true, trim: true, lowercase: true },
    applicantPhone: { type: String, default: "" },

    // Réponses aux champs personnalisés du formulaire (programme ou modèle
    // spontané), clé = field.id.
    responses: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED"],
      default: "PENDING",
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
    reviewedAt: { type: Date, default: null },

    // Rempli à l'acceptation — le profil Volunteer trouvé-ou-créé pour ce
    // candidat (voir volunteerApplicationController.acceptApplication).
    volunteerId: { type: mongoose.Schema.Types.ObjectId, ref: "Volunteer", default: null },
  },
  { timestamps: true }
);

// Une seule candidature par programme et par email — ne s'applique pas aux
// candidatures spontanées (programId null), qui peuvent se répéter dans le
// temps (index partiel : n'indexe que les documents où programId existe).
VolunteerApplicationSchema.index(
  { programId: 1, applicantEmail: 1 },
  { unique: true, partialFilterExpression: { programId: { $type: "objectId" } } }
);

module.exports = function getVolunteerApplicationModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (VolunteerApplication)");
  }

  return formDB.models.VolunteerApplication || formDB.model("VolunteerApplication", VolunteerApplicationSchema);
};
