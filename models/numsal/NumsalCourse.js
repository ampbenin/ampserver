/**
 * Modèle Course – Plateforme NumSAL
 * Un cours = une liste ordonnée de leçons (texte / vidéo / PDF), possédée
 * par un formateur. MVP : pas de quiz, pas de note, pas de certificat.
 *
 * Un programme peut être en ligne, présentiel ou hybride, et son accès
 * peut être ouvert (tout apprenant connecté) ou soumis à candidature
 * (formulaire personnalisé + admission par un formateur/tuteur rattaché).
 */

const mongoose = require("mongoose");

const LessonSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  order: { type: Number, required: true },
  contentType: {
    type: String,
    enum: ["TEXT", "VIDEO_EMBED", "VIDEO_LINK", "PDF_LINK"],
    required: true,
  },
  // Texte riche (HTML) quand contentType === "TEXT"
  contentBody: { type: String, default: "" },
  // URL d'intégration/lien vidéo ou lien PDF pour les autres types
  contentUrl: { type: String, default: "" },
});

// Un champ du formulaire de candidature (façon Google Form), défini par
// programme. `validation` n'est utilisé que pour les types concernés.
const ApplicationFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // identifiant stable, clé dans NumsalApplication.responses
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["TEXT", "TEXTAREA", "EMAIL", "PHONE", "NUMBER", "DATE", "SELECT", "CHECKBOX"],
      required: true,
    },
    required: { type: Boolean, default: false },
    // Champ "système" (nom complet, email) injecté automatiquement dans
    // chaque formulaire — modifiable/déplaçable comme les autres, mais
    // jamais supprimable (l'email est indispensable pour créer le compte
    // du candidat admis). Le téléphone n'est PAS verrouillé : entièrement
    // libre, comme un champ créé par le formateur.
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

const NumsalCourseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    trainerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalUser",
      required: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      default: "DRAFT",
    },
    coverImageUrl: { type: String, default: "" },
    lessons: { type: [LessonSchema], default: [] },

    // Coché par l'admin pour faire apparaître ce programme dans les
    // "Programmes phares" de la page d'accueil publique.
    featuredOnHome: { type: Boolean, default: false },

    modality: {
      type: String,
      enum: ["ONLINE", "IN_PERSON", "HYBRID"],
      default: "ONLINE",
    },

    // OPEN = accès immédiat pour tout apprenant connecté ; APPLICATION =
    // passe obligatoirement par une candidature + admission.
    accessMode: {
      type: String,
      enum: ["OPEN", "APPLICATION"],
      default: "APPLICATION",
    },

    // Tuteurs rattachés à ce programme, autorisés (avec le formateur
    // propriétaire et l'ADMIN) à évaluer ses candidatures.
    tutorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "NumsalUser", default: [] }],

    // Texte libre inclus dans l'email d'admission (horaires, lieu...).
    admissionInstructions: { type: String, default: "" },

    // Coordonnées affichées en boutons cliquables (WhatsApp / email) dans les
    // emails automatiques liés à ce programme (réception de candidature,
    // admission) — pour qu'un candidat puisse poser une question.
    contactWhatsapp: { type: String, default: "" },
    contactEmail: { type: String, default: "" },

    // Pertinent uniquement quand accessMode === "APPLICATION".
    applicationForm: {
      fields: { type: [ApplicationFieldSchema], default: [] },
    },
  },
  { timestamps: true }
);

module.exports = function getNumsalCourseModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalCourse)");
  }

  return formDB.models.NumsalCourse || formDB.model("NumsalCourse", NumsalCourseSchema);
};
