/**
 * Modèle Finance – GESTION AMP (DB2)
 * Lié à une activité (hérite de l'espace)
 */

const mongoose = require("mongoose");

/**
 * Schéma Finance
 */
const FinanceSchema = new mongoose.Schema(
  {
    // Référence à l'activité
    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpActivity",
      required: true,
    },

    // Type de mouvement financier
    type: {
      type: String,
      enum: ["INCOME", "EXPENSE"],
      required: true,
    },

    // Montant (positif)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    description: {
      type: String,
      default: "",
    },

    /**
     * 🔹 ESPACE EC
     */
    coordinationCommunaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpCoordinationCommunale",
      default: null,
    },

    /**
     * 🔹 ESPACE IS
     */
    institutionSpecialiseeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpInstitutionSpecialisee",
      default: null,
    },

    // Auteur
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * 🔐 Validation stricte multi-tenant
 */
FinanceSchema.pre("validate", function (next) {
  const hasCC = !!this.coordinationCommunaleId;
  const hasIS = !!this.institutionSpecialiseeId;

  if (hasCC === hasIS) {
    return next(
      new Error(
        "Une finance doit être liée soit à une Coordination Communale soit à une Institution Spécialisée"
      )
    );
  }

  next();
});

/**
 * ✅ Loader lazy sécurisé du modèle (DB2)
 */
module.exports = function getFinanceModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (GestionAmpFinance)");
  }

  return (
    formDB.models.GestionAmpFinance ||
    formDB.model("GestionAmpFinance", FinanceSchema)
  );
};
