/**
 * Schéma de champ de formulaire de candidature (façon Google Form), partagé
 * entre tous les systèmes de "programme + candidature" de ce backend
 * (NumSAL aujourd'hui, programmes de volontariat AMP Bénin). Extrait depuis
 * models/numsal/NumsalCourse.js pour être réutilisé sans duplication —
 * `validation`/`conditional` ne sont utilisés que par les types concernés.
 */

const mongoose = require("mongoose");

const ApplicationFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // identifiant stable, clé dans les réponses (responses Map)
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["TEXT", "TEXTAREA", "EMAIL", "PHONE", "NUMBER", "DATE", "SELECT", "CHECKBOX"],
      required: true,
    },
    required: { type: Boolean, default: false },
    // Champ "système" (nom, email...) injecté automatiquement dans chaque
    // formulaire — modifiable/déplaçable comme les autres, mais jamais
    // supprimable. Le téléphone n'est PAS verrouillé : entièrement libre,
    // comme un champ créé par le gestionnaire du programme.
    locked: { type: Boolean, default: false },
    options: { type: [String], default: [] }, // pour SELECT
    validation: {
      minLength: { type: Number, default: null },
      maxLength: { type: Number, default: null },
      pattern: { type: String, default: "" },
      min: { type: Number, default: null },
      max: { type: Number, default: null },
    },
    // Sous-champ conditionnel : n'apparaît que si le champ `fieldId` (une
    // liste déroulante ou une case à cocher) a répondu une des `values`.
    // Peut chaîner sur plusieurs niveaux (un sous-champ peut lui-même être
    // le déclencheur d'un autre sous-champ).
    conditional: {
      fieldId: { type: String, default: "" },
      values: { type: [String], default: [] },
    },
  },
  { _id: false }
);

module.exports = ApplicationFieldSchema;
