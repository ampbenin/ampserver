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

    // Tâches que chaque volontaire ACCEPTÉ à ce programme doit accomplir
    // (voir models/volunteerTaskSubmission.js pour le suivi des preuves).
    // `id` est généré côté client (même pattern que ApplicationFieldSchema),
    // stable dans le temps — les soumissions y font référence.
    tasks: [
      {
        _id: false,
        id: { type: String, required: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, default: "" },
        // ONCE = une seule fois ; DAILY/WEEKLY = une échéance par jour/semaine,
        // de la date d'acceptation du volontaire à la fin du programme (voir
        // utils/volunteerTaskLogic.js).
        recurrence: { type: String, enum: ["ONCE", "DAILY", "WEEKLY"], default: "ONCE" },
        // DRAFT = jamais visible/due côté volontaire. SCHEDULED = devient
        // PUBLISHED tout seul dès que scheduledPublishAt est dépassée (voir
        // resolveTaskStatus dans volunteerTaskController.js — même pattern
        // de vérification paresseuse que closeExpiredPrograms, pas de cron).
        // Défaut PUBLISHED : les tâches créées avant ce champ restent
        // visibles telles quelles, aucune migration nécessaire.
        status: { type: String, enum: ["DRAFT", "SCHEDULED", "PUBLISHED"], default: "PUBLISHED" },
        scheduledPublishAt: { type: Date, default: null },
        // Formulaire de preuve spécifique à cette tâche (texte, URL avec
        // aperçu, image(s) uploadées vers Cloudinary...) — même schéma que
        // applicationForm.fields. Si vide, controllers/volunteerTaskController.js
        // applique un repli par défaut (un champ Description obligatoire),
        // donc les tâches créées avant ce champ restent utilisables telles
        // quelles sans script de migration.
        proofForm: {
          fields: { type: [ApplicationFieldSchema], default: [] },
        },
      },
    ],

    // % d'occurrences de tâches dues et approuvées à partir duquel le statut
    // du volontaire sur ce programme passe à "Mission validée" au moment de
    // "Terminer les missions" (voir volunteerTaskController.finalizeMissions)
    // — ne s'applique que si `tasks` n'est pas vide, et ne rétrograde jamais
    // un statut déjà positionné manuellement.
    missionValidationThreshold: { type: Number, default: 100, min: 0, max: 100 },

    // Posé une seule fois par "Terminer les missions" (action manuelle,
    // irréversible) — bascule d'un coup tous les volontaires "Non
    // disponible" de ce programme vers "Mission validée" ou "Refusé" selon
    // le seuil, et bloque toute nouvelle soumission de tâche au-delà.
    missionsFinalizedAt: { type: Date, default: null },

    // Bannière "Barre des partenaires" — propre à CE programme (corrigé le
    // 2026-08-07 : d'abord posée comme réglage global dans SiteSettings,
    // puis l'utilisateur a précisé "c'est une image propre à chaque
    // programme, seuls les partenaires où ce programme a été affecté
    // verront ça"). Définie par un ADMIN/EDITOR (onglet "Partenaires" de
    // VolunteerProgramEditor.jsx), affichée tout en bas du tableau de bord
    // d'un partenaire suivant CE programme + sur chaque page du rapport
    // PDF de CE programme — jamais mélangée avec un autre programme.
    partnersBarImageUrl: { type: String, default: null },
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
