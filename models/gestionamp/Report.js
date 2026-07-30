/**
 * Modèle Report – GESTION AMP (DB2)
 */

const mongoose = require("mongoose");

/**
 * Schéma Report
 */
const ReportSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
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

    status: {
      type: String,
      enum: ["DRAFT", "VALIDATED"],
      default: "DRAFT",
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      required: true,
    },

    validatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GestionAmpUser",
      default: null,
    },

    validatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/**
 * 🔒 Isolation stricte multi-tenant
 */
ReportSchema.pre("validate", function (next) {
  const hasCC = !!this.coordinationCommunaleId;
  const hasIS = !!this.institutionSpecialiseeId;

  if (hasCC === hasIS) {
    return next(
      new Error(
        "Un rapport doit être lié soit à une Coordination Communale soit à une Institution Spécialisée"
      )
    );
  }

  next();
});

/**
 * ✅ Loader lazy sécurisé du modèle (DB2)
 */
module.exports = function getReportModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (GestionAmpReport)");
  }

  return (
    formDB.models.GestionAmpReport ||
    formDB.model("GestionAmpReport", ReportSchema)
  );
};
