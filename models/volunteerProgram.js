/**
 * Modèle VolunteerProgram — Programmes de volontariat AMP Bénin
 * Remplace l'ancien modèle Mission (titre/lieu/dates minimaliste, jamais
 * visible publiquement) par un vrai "programme" façon NumSAL : statut de
 * publication, formulaire de candidature personnalisable, fermeture
 * automatique à l'échéance, couleur de marque par programme.
 *
 * Vit sur global.formDB (comme NumSAL et GestionAmpUser), contrairement à
 * l'ancien Mission qui vivait sur la connexion par défaut — voir le plan de
 * migration pour le raisonnement (alignement avec le pattern déjà en place
 * pour "programme + candidature" dans ce backend).
 */

const mongoose = require("mongoose");
const ApplicationFieldSchema = require("./shared/applicationFieldSchema");

const VolunteerProgramSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    coverImageUrl: { type: String, default: "" },

    // CLOSED n'est jamais choisi manuellement à la création — pris
    // automatiquement quand applicationDeadline est dépassée (voir
    // closeExpiredPrograms dans volunteerProgramController.js), ou fermé
    // manuellement par un ADMIN/EDITOR (ex : places déjà pourvues).
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED", "CLOSED"],
      default: "DRAFT",
    },

    location: { type: String, default: "" },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    // Nombre de places, optionnel — purement informatif pour l'instant (pas
    // de blocage automatique des candidatures au-delà de la capacité).
    capacity: { type: Number, default: null },

    // OPEN = inscription directe (pas de formulaire de candidature) ;
    // APPLICATION = passe par une candidature + admission.
    accessMode: {
      type: String,
      enum: ["OPEN", "APPLICATION"],
      default: "APPLICATION",
    },

    // Vide = candidatures ouvertes en tout temps. Une fois dépassée, le
    // programme passe automatiquement au statut CLOSED.
    applicationDeadline: { type: Date, default: null },

    // Couleur de marque du programme (hex #RRGGBB) — pilote le dégradé de
    // fond et les boutons de l'assistant de candidature côté candidat. Vide
    // = identité par défaut du site.
    brandColor: { type: String, default: "" },

    contactWhatsapp: { type: String, default: "" },
    contactEmail: { type: String, default: "" },

    // Texte libre inclus dans l'email d'admission (horaires, lieu, matériel...).
    admissionInstructions: { type: String, default: "" },

    // Staff autorisé à examiner les candidatures de CE programme, en plus
    // de tout ADMIN/EDITOR. Référence cross-connection vers GestionAmpUser
    // (formDB), même limite que VolunteerForm.handledBy déjà existant.
    reviewerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: [] }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },

    // Pertinent uniquement quand accessMode === "APPLICATION".
    applicationForm: {
      fields: { type: [ApplicationFieldSchema], default: [] },
      // Texte libre (ex : "5 minutes"), affiché sur l'écran de couverture
      // du candidat à la place d'une estimation calculée.
      estimatedDuration: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

module.exports = function getVolunteerProgramModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (VolunteerProgram)");
  }

  return formDB.models.VolunteerProgram || formDB.model("VolunteerProgram", VolunteerProgramSchema);
};
