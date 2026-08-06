/**
 * Modèle VolunteerReport — Signalement d'un volontaire "indélicat"
 * (voir controllers/volunteerDisciplineController.js). Peut être soumis par
 * ADMIN/EDITOR/SUPERVISEUR/PARTENAIRE, scopé au volontaire "affecté" à eux
 * (canReportVolunteer). Traité uniquement par un ADMIN, qui décide d'une
 * sanction (ou de classer sans suite) — voir models/volunteerSanction.js.
 *
 * Vit sur la MÊME connexion que Volunteer (par défaut, pas formDB) — c'est
 * fondamentalement une extension de l'identité volontaire. reportedBy et
 * programId référencent GestionAmpUser/VolunteerProgram (formDB) :
 * cross-connection, pas de .populate(), résolution manuelle si besoin
 * (même limite déjà acceptée partout ailleurs dans ce projet).
 */

const mongoose = require("mongoose");

const VolunteerReportSchema = new mongoose.Schema(
  {
    volunteerId: { type: mongoose.Schema.Types.ObjectId, ref: "Volunteer", required: true },
    programId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Dénormalisé au moment du signalement (le JWT gestionamp porte le rôle
    // mais pas le nom — reportedBy est résolu manuellement à l'affichage,
    // cross-connection vers GestionAmpUser, même limite qu'ailleurs).
    reportedByRole: { type: String, default: "" },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ["PENDING", "REVIEWED"], default: "PENDING" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
    // Ce qui a résulté du traitement (sanction posée, ou classé sans suite).
    resolution: { type: String, enum: ["WARNING", "SUSPENSION", "BAN", "DISMISSED", null], default: null },
    sanctionId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerSanction", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.VolunteerReport || mongoose.model("VolunteerReport", VolunteerReportSchema);
