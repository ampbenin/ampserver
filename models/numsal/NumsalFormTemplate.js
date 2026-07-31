/**
 * Modèle FormTemplate – Plateforme NumSAL
 * Une bibliothèque de formulaires de candidature réutilisables : un
 * formateur/admin peut enregistrer le formulaire d'un programme sous un nom,
 * indépendamment de tout programme précis, puis l'importer dans le
 * formulaire d'un autre programme (copie des champs, pas de référence
 * partagée — modifier un modèle après import n'affecte pas les programmes
 * qui l'ont déjà importé, exactement comme copier-coller).
 */

const mongoose = require("mongoose");
const { ApplicationFieldSchema } = require("./NumsalCourse");

const NumsalFormTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    fields: { type: [ApplicationFieldSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = function getNumsalFormTemplateModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalFormTemplate)");
  }

  return formDB.models.NumsalFormTemplate || formDB.model("NumsalFormTemplate", NumsalFormTemplateSchema);
};
