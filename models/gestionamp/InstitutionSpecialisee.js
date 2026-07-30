/**
 * Modèle Institution Spécialisée – GESTION AMP (DB2)
 * Représente un espace IS (multi-tenant)
 */

const mongoose = require("mongoose");

/**
 * 🔐 Schéma Institution Spécialisée
 */
const InstitutionSpecialiseeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    domaine: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

/**
 * ✅ Loader lazy sécurisé du modèle (DB2)
 */
module.exports = function getInstitutionSpecialiseeModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (InstitutionSpecialisee)");
  }

  return (
    formDB.models.GestionAmpInstitutionSpecialisee ||
    formDB.model(
      "GestionAmpInstitutionSpecialisee",
      InstitutionSpecialiseeSchema
    )
  );
};
