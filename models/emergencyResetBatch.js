/**
 * Modèle EmergencyResetBatch — mesure temporaire de réinitialisation de
 * mot de passe "d'urgence" pour les volontaires bloqués hors de leur
 * compte (lien de définition de mot de passe expiré avant utilisation).
 *
 * Un ADMIN active la mesure pour un ou plusieurs comptes précis, ou pour
 * tous les volontaires d'un programme — ce qui crée UN lot (batch) avec :
 * - un `token` aléatoire unique, qui compose l'URL publique partagée
 *   (ex. /mon-espace/urgence/{token}) — change à chaque nouvelle
 *   génération (jamais réutilisé), et expire après `expiresAt`.
 * - un `validationField` unique choisi par l'ADMIN (nom/prénom/téléphone/
 *   âge) — la question de contrôle que CHAQUE volontaire concerné devra
 *   répondre correctement (comparée à sa propre fiche) avant de pouvoir
 *   définir un nouveau mot de passe. Pas de token secret individuel — la
 *   sécurité vient de cette question + de la portée limitée du lot.
 * - `usedByVolunteerIds` : dès qu'un volontaire réinitialise avec succès
 *   via ce lot, il y est ajouté et ne peut plus réutiliser CE lot (usage
 *   unique par compte), sans affecter les autres volontaires du même lot
 *   ni la validité du lien pour eux.
 *
 * Vit sur la connexion par défaut, comme Volunteer/VolunteerSanction —
 * extension de l'identité volontaire, pas une donnée d'admin formDB.
 * `programId`/`createdBy` référencent formDB (VolunteerProgram/
 * GestionAmpUser) — référence inter-connexion, même limite déjà acceptée
 * partout ailleurs dans ce backend (pas de .populate(), résolution
 * manuelle si besoin d'afficher un titre/nom).
 */

const mongoose = require("mongoose");

const EmergencyResetBatchSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },

    validationField: {
      type: String,
      enum: ["nom", "prenom", "telephone", "age"],
      required: true,
    },

    targetType: { type: String, enum: ["VOLUNTEERS", "PROGRAM"], required: true },
    // Pertinent si targetType === "VOLUNTEERS" — liste figée au moment de
    // la création du lot.
    volunteerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Volunteer", default: [] }],
    // Pertinent si targetType === "PROGRAM" — résolu à la volée à chaque
    // vérification (Volunteer.find({"programs.programId": programId})),
    // pas figé, pour couvrir aussi un volontaire admis après coup pendant
    // que la mesure est active.
    programId: { type: mongoose.Schema.Types.ObjectId, default: null },

    expiresAt: { type: Date, required: true },
    // Désactivation manuelle anticipée par l'ADMIN, indépendante de
    // expiresAt (ex. "je me suis trompé de champ, je coupe tout de suite").
    active: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },

    usedByVolunteerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Volunteer", default: [] }],
  },
  { timestamps: true }
);

module.exports = mongoose.models.EmergencyResetBatch || mongoose.model("EmergencyResetBatch", EmergencyResetBatchSchema);
