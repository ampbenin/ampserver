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
      // URL/IMAGE ajoutés pour les formulaires de preuve de tâche de
      // volontariat (voir models/volunteerProgram.js#tasks.proofForm) — non
      // exposés dans le constructeur du formulaire de candidature
      // (PROOF_FIELD_TYPES y est distinct de FIELD_TYPES côté frontend),
      // mais le schéma reste partagé pour éviter toute duplication. FILE
      // ajouté pour le formulaire de candidature au recrutement (CV,
      // diplôme...) — voir JobApplicationForm.jsx/JobRecruitmentManager.jsx ;
      // distinct d'IMAGE (une seule pièce jointe, tout type de fichier au
      // lieu d'image uniquement, taille/type limités par validation ci-dessous
      // plutôt que par un compte maximum).
      enum: ["TEXT", "TEXTAREA", "EMAIL", "PHONE", "NUMBER", "DATE", "SELECT", "CHECKBOX", "URL", "IMAGE", "FILE"],
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
      // Pertinent uniquement pour IMAGE — nombre maximum de photos acceptées
      // pour ce champ (null = pas de limite au-delà du bon sens de l'UI).
      maxImages: { type: Number, default: null },
      // Pertinent uniquement pour FILE — imposés côté client au moment de
      // l'upload (comme maxImages ci-dessus, pas re-vérifiés côté serveur à
      // la soumission : même niveau de garantie que le reste de ce schéma).
      // null/vide = pas de limite au-delà du plafond serveur global (voir
      // routes/jobApplicationRoute.js).
      maxFileSizeMB: { type: Number, default: null },
      allowedFileTypes: { type: [String], default: [] }, // extensions sans le point, ex: ["pdf","docx"]
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
