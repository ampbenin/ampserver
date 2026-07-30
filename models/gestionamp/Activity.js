/**
 * Modèle Activity / Projet – GESTION AMP (DB2)
 * Supporte EC et IS (multi-tenant)
 */

const mongoose = require("mongoose");

/**
 * Schéma Activity
 */
const ActivitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    // Statut de validation
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "VALIDATED"],
      default: "DRAFT",
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

    // Auteur (EC ou IS)
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
 * 🔐 Validation multi-tenant stricte
 */
ActivitySchema.pre("validate", function (next) {
  const hasCC = !!this.coordinationCommunaleId;
  const hasIS = !!this.institutionSpecialiseeId;

  if (hasCC === hasIS) {
    return next(
      new Error(
        "Une activité doit être liée soit à une Coordination Communale soit à une Institution Spécialisée"
      )
    );
  }

  next();
});

/**
 * ✅ Loader lazy sécurisé du modèle (DB2)
 */
module.exports = function getActivityModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (GestionAmpActivity)");
  }

  return (
    formDB.models.GestionAmpActivity ||
    formDB.model("GestionAmpActivity", ActivitySchema)
  );
};
