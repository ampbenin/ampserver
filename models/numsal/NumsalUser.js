/**
 * Modèle User – Plateforme NumSAL (sous-site indépendant)
 * Comptes apprenant/formateur/tuteur/admin de numsal.ampbenin.org.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const NumsalUserSchema = new mongoose.Schema(
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
      enum: ["APPRENANT", "FORMATEUR", "TUTEUR", "ADMIN"],
      required: true,
    },

    phone: { type: String, default: "" },
    bio: { type: String, default: "" },

    // Un tuteur suit un sous-ensemble d'apprenants — liste embarquée
    // (échelle attendue : une cohorte de formation, pas des milliers
    // d'utilisateurs, donc pas besoin d'une collection de jointure séparée).
    assignedLearnerIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "NumsalUser", default: [] },
    ],

    // Les apprenants choisissent leur mot de passe à l'inscription ; les
    // formateurs/tuteurs reçoivent un mot de passe temporaire de l'admin
    // NumSAL et doivent le changer à la première connexion.
    mustChangePassword: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },

    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

NumsalUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

NumsalUserSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = function getNumsalUserModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalUser)");
  }

  return formDB.models.NumsalUser || formDB.model("NumsalUser", NumsalUserSchema);
};
