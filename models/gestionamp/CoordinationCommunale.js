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

    // Désactiver plutôt que supprimer quand des comptes/activités y sont
    // encore rattachés (décision utilisateur, 2026-09-30 : "il faut un
    // moyen pour vérifier les données et on peut supprimer. Ou désactivé")
    // — la suppression reste bloquée tant que des données existent (voir
    // makeSpaceCrud.js), la désactivation retire l'espace des sélecteurs
    // sans perdre l'historique.
    isActive: { type: Boolean, default: true },
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
