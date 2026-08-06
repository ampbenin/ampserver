/**
 * Modèle VolunteerApplicationGroup — Groupes de candidatures (façon "tag" nommé)
 * pour un programme de volontariat. Outil d'organisation pour le staff : un
 * groupe peut contenir des candidatures de n'importe quel statut (en attente/
 * acceptée/rejetée) et une candidature peut appartenir à plusieurs groupes.
 * Sert aussi de raccourci lors de l'affectation d'un superviseur (voir
 * controllers/volunteerApplicationGroupController.js) — uniquement les
 * membres ACCEPTED (donc avec un volunteerId résolu) comptent alors.
 *
 * Vit sur global.formDB, comme VolunteerApplication et VolunteerProgram —
 * contrairement à Volunteer (connexion par défaut), donc .populate() sur
 * applicationIds fonctionne normalement ici, sans la limite inter-connexion
 * déjà acceptée ailleurs dans ce chantier.
 */

const mongoose = require("mongoose");

const VolunteerApplicationGroupSchema = new mongoose.Schema(
  {
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", required: true },
    name: { type: String, required: true, trim: true },
    applicationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "VolunteerApplication" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
  },
  { timestamps: true }
);

module.exports = function getVolunteerApplicationGroupModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (VolunteerApplicationGroup)");
  }

  return formDB.models.VolunteerApplicationGroup
    || formDB.model("VolunteerApplicationGroup", VolunteerApplicationGroupSchema);
};
