/**
 * Modèle User – GESTION AMP (DB2)
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

/**
 * 🔐 Schéma utilisateur
 */
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: { type: String, required: true },

    role: {
      type: String,
      enum: ["ADMIN", "EDITOR", "EC", "IS", "SUPERVISEUR", "PARTENAIRE"],
      required: true,
    },

    coordinationCommunaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpCoordinationCommunale",
      default: null,
    },

    institutionSpecialiseeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpInstitutionSpecialisee",
      default: null,
    },

    // Pertinent seulement si role === "SUPERVISEUR" : un superviseur ne
    // suit jamais tout un programme automatiquement, seulement le
    // sous-ensemble précis de volontaires qu'on lui affecte ici, programme
    // par programme (voir controllers/volunteerProgramController.js).
    // `volunteerIds` référence Volunteer, qui vit sur la connexion par
    // défaut — référence inter-connexion, même limite déjà acceptée
    // partout ailleurs dans ce chantier (pas de populate).
    supervisedAssignments: [
      {
        _id: false,
        programId: { type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", required: true },
        volunteerIds: [{ type: mongoose.Schema.Types.ObjectId, required: true }],
      },
    ],

    // Pertinent seulement si role === "PARTENAIRE" : programmes suivis en
    // lecture seule (statistiques, volontaires à mission validée,
    // commentaires) — voir controllers/volunteerProgramPartnerController.js.
    partnerProgramIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "VolunteerProgram", default: [] }],

    mustChangePassword: { type: Boolean, default: true },

    isActive: { type: Boolean, default: true },

    // Réinitialisation de mot de passe : on ne stocke jamais le token en
    // clair, seulement son empreinte (SHA-256), avec une expiration courte.
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * 🔐 Hash mot de passe
 */
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * 🔍 Comparaison mot de passe
 */
UserSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * 🛡️ Validation métier
 */
UserSchema.pre("validate", function (next) {
  if (this.role === "EC" && !this.coordinationCommunaleId) {
    return next(
      new Error("Un utilisateur EC doit être lié à une Coordination Communale")
    );
  }

  if (this.role === "IS" && !this.institutionSpecialiseeId) {
    return next(
      new Error("Un utilisateur IS doit être lié à une Institution Spécialisée")
    );
  }

  if (this.role === "ADMIN" || this.role === "EDITOR") {
    this.coordinationCommunaleId = null;
    this.institutionSpecialiseeId = null;
  }

  next();
});

/**
 * ✅ Lazy export du modèle (APPEL APRÈS connexion DB)
 */
module.exports = function getUserModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (appel trop tôt)");
  }

  return (
    formDB.models.GestionAmpUser ||
    formDB.model("GestionAmpUser", UserSchema)
  );
};
