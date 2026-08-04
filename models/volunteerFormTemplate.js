/**
 * Modèle VolunteerFormTemplate — Bibliothèque de formulaires de candidature
 * réutilisables entre programmes de volontariat (mirror de
 * NumsalFormTemplate). Un formulaire peut être enregistré comme modèle
 * nommé depuis un programme existant, puis importé dans n'importe quel
 * autre programme.
 *
 * `isSpontaneousDefault` marque le modèle utilisé pour les candidatures
 * spontanées (sans programme précis) — un seul à la fois, appliqué par
 * volunteerFormTemplateController (désactive les autres à l'activation
 * d'un nouveau).
 */

const mongoose = require("mongoose");
const ApplicationFieldSchema = require("./shared/applicationFieldSchema");

const VolunteerFormTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    fields: { type: [ApplicationFieldSchema], default: [] },
    isSpontaneousDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = function getVolunteerFormTemplateModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (VolunteerFormTemplate)");
  }

  return formDB.models.VolunteerFormTemplate || formDB.model("VolunteerFormTemplate", VolunteerFormTemplateSchema);
};
