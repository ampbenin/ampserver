/**
 * Modèle VolunteerSanction — Source de vérité UNIQUE pour "ce volontaire
 * est-il actuellement averti/suspendu ?" (jamais de champ dupliqué sur
 * Volunteer — toujours interrogé frais, voir
 * controllers/volunteerDisciplineController.js et l'intégration dans
 * volunteerAuthController.js#login / middlewares/volunteer/authMiddleware.js).
 *
 * WARNING  : rien sur Volunteer, juste ce document (lu par "Mon espace" +
 *            email) — acknowledgedAt une fois vu par le volontaire.
 * SUSPENSION : Volunteer.isActive = false pendant la période
 *            (suspendedUntil) — réactivation automatique à la date prévue
 *            (vérifiée à la connexion, pas de cron).
 * BAN      : le document Volunteer est SUPPRIMÉ (voir
 *            models/blacklistedVolunteer.js pour ce qui en reste) — cette
 *            sanction elle-même n'est donc plus consultable que via son
 *            historique si elle a été conservée avant suppression du
 *            volontaire (volunteerId devient une référence morte).
 *
 * Vit sur la même connexion que Volunteer (par défaut, pas formDB).
 */

const mongoose = require("mongoose");

const VolunteerSanctionSchema = new mongoose.Schema(
  {
    volunteerId: { type: mongoose.Schema.Types.ObjectId, ref: "Volunteer", required: true },
    type: { type: String, enum: ["WARNING", "SUSPENSION", "BAN"], required: true },
    reason: { type: String, required: true, trim: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerReport", default: null },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    appliedAt: { type: Date, default: Date.now },

    // SUSPENSION uniquement.
    suspendedUntil: { type: Date, default: null },

    status: { type: String, enum: ["ACTIVE", "LIFTED"], default: "ACTIVE" },
    liftedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    liftedAt: { type: Date, default: null },
    liftReason: { type: String, default: "" },

    // WARNING uniquement — le bandeau "Mon espace" disparaît une fois lu.
    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.VolunteerSanction || mongoose.model("VolunteerSanction", VolunteerSanctionSchema);
