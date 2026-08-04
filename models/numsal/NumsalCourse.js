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
const ApplicationFieldSchema = require("../shared/applicationFieldSchema");

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

const NumsalCourseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    trainerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NumsalUser",
      required: true,
    },
    // CLOSED n'est jamais choisi manuellement à la création — il est pris
    // automatiquement par le backend quand applicationDeadline est dépassée
    // (voir closeExpiredCourses dans courseController.js), et ne redevient
    // PUBLISHED que si un admin/formateur le republie explicitement.
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED", "CLOSED"],
      default: "DRAFT",
    },
    coverImageUrl: { type: String, default: "" },
    lessons: { type: [LessonSchema], default: [] },

    // Couleur de marque du programme (hex, ex : "#5B21B6") — pilote le
    // dégradé de fond et les boutons de l'assistant de candidature
    // (Typeform-like) côté candidat. Vide = identité violette par défaut de
    // NumSAL (voir derivePalette dans ApplicationForm.jsx).
    brandColor: { type: String, default: "" },

    // Durée du programme lui-même (texte libre, ex : "3 mois", "6 séances de 2h").
    duration: { type: String, default: "" },

    // Date limite pour postuler — vide = candidatures ouvertes en tout
    // temps. Une fois dépassée, le programme passe automatiquement au
    // statut CLOSED (voir closeExpiredCourses). Pertinent uniquement quand
    // accessMode === "APPLICATION".
    applicationDeadline: { type: Date, default: null },

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
      // Texte libre saisi par le formateur/admin (ex : "5 minutes"),
      // affiché sur l'écran de couverture du candidat à la place d'une
      // estimation calculée automatiquement à partir du nombre de champs.
      estimatedDuration: { type: String, default: "" },
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

// Réutilisé tel quel par NumsalFormTemplate — un modèle de formulaire stocke
// exactement le même type de champs qu'un programme, pour pouvoir être
// importé directement dans applicationForm.fields sans conversion.
module.exports.ApplicationFieldSchema = ApplicationFieldSchema;
