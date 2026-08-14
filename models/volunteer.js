// models/volunteer.js

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const VolunteerSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true, trim: true },
    prenom: { type: String, required: true, trim: true },
    fullName: { type: String, trim: true }, // généré automatiquement

    // lowercase ajouté avec les champs de compte ci-dessous, pour être
    // cohérent avec GestionAmpUser/NumsalUser/VolunteerApplication.applicantEmail
    // (déjà lowercase) — évite les doublons "Jean@x.com" / "jean@x.com".
    email: { type: String, required: true, trim: true, lowercase: true },
    telephone: { type: String },

    // Ajouté 2026-08-14 pour la mesure de réinitialisation d'urgence
    // (voir models/emergencyResetBatch.js) — sert de question de contrôle
    // possible ("Âge") au même titre que nom/prénom/téléphone. Optionnel,
    // vide pour la quasi-totalité des fiches existantes tant que le staff
    // ne le renseigne pas manuellement (VolunteersManager.jsx/SaveVolunteers.jsx).
    dateNaissance: { type: Date, default: null },

    // ✅ Compte "Mon espace" — ce document EST le compte, pas une collection
    // séparée (contrairement à NumsalUser) : un profil Volunteer existe déjà
    // souvent avant tout compte (créé par le staff ou à l'acceptation d'une
    // candidature), donc "créer un compte" = ajouter un mot de passe à la
    // fiche existante trouvée par email, jamais une fiche en doublon. `null`
    // = compte pas encore activé (candidat/volontaire connu mais qui ne
    // s'est jamais connecté). Jamais de mot de passe en clair envoyé par
    // email : toujours défini via un lien à usage unique (voir
    // controllers/volunteerAuthController.js), d'où l'absence d'un flag
    // mustChangePassword ici (inutile avec ce mécanisme).
    password: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },

    statut: {
      type: String,
      enum: ["Non disponible", "Refusé", "Mission validée"],
      default: "Non disponible",
    },

    // ✅ Tableau des programmes pour gérer plusieurs programmes de
    // volontariat. `programId` référence VolunteerProgram — une référence
    // inter-connexion (Volunteer vit sur la connexion par défaut,
    // VolunteerProgram sur formDB), même limite déjà acceptée aujourd'hui
    // pour VolunteerForm.handledBy → GestionAmpUser : pas de .populate()
    // automatique, il faut résoudre le nom du programme séparément si
    // besoin. Alimenté automatiquement à l'acceptation d'une candidature
    // (voir volunteerApplicationController.acceptApplication), plus
    // manuellement via SaveVolunteers.jsx.
    programs: [
      {
        programId: { type: mongoose.Schema.Types.ObjectId, required: true },
        statut: {
          type: String,
          enum: ["Non disponible", "Refusé", "Mission validée"],
          default: "Non disponible",
        },
        assignedAt: { type: Date, default: Date.now },
      },
    ],

    // ✅ Stockage cloud des attestations
    attestations: [
      {
        programId: { type: mongoose.Schema.Types.ObjectId, required: true },
        programName: { type: String },
        fileName: { type: String },
        fileUrl: { type: String },
        statut: {
          type: String,
          enum: ["Non disponible", "Refusé", "Mission validée"],
          default: "Non disponible",
        },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Générer fullName automatiquement avant sauvegarde
VolunteerSchema.pre("save", function (next) {
  this.fullName = `${this.nom} ${this.prenom}`;
  next();
});

// Hash du mot de passe (seulement s'il vient d'être défini/modifié)
VolunteerSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

VolunteerSchema.methods.comparePassword = function (candidatePassword) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidatePassword, this.password);
};

// Recalcule fullName sur findOneAndUpdate
VolunteerSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate() || {};
  if (update.nom || update.prenom) {
    const doc = await this.model.findOne(this.getQuery()).select("nom prenom");
    const newNom = update.nom ?? doc.nom;
    const newPrenom = update.prenom ?? doc.prenom;
    update.fullName = `${newNom} ${newPrenom}`.trim();
    this.setUpdate(update);
  }
  next();
});

// 🔹 Index unique sur email uniquement (un volontaire par email)
VolunteerSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.Volunteer || mongoose.model("Volunteer", VolunteerSchema);
