/**
 * Modèle Coordination Communale – GESTION AMP (DB2)
 * Représente un espace EC (multi-tenant)
 */

const mongoose = require("mongoose");

/**
 * 🔐 Schéma Coordination Communale
 */
const CoordinationCommunaleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    commune: {
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
module.exports = function getCoordinationCommunaleModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (CoordinationCommunale)");
  }

  return (
    formDB.models.GestionAmpCoordinationCommunale ||
    formDB.model(
      "GestionAmpCoordinationCommunale",
      CoordinationCommunaleSchema
    )
  );
};
