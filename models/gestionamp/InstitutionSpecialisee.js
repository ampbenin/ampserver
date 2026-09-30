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
