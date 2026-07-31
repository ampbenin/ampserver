/**
 * Modèle Partner – Plateforme NumSAL
 * Un partenaire affiché sur la page publique /partenaires : nom, courte
 * description, logo et lien vers leur site — géré entièrement par l'admin
 * NumSAL (pas de CRUD formateur/tuteur/apprenant sur ce contenu).
 */

const mongoose = require("mongoose");

const NumsalPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    logoUrl: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },
    // Ordre d'affichage sur la page publique — modifiable via les flèches
    // de réordonnancement dans le tableau de bord admin.
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = function getNumsalPartnerModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (NumsalPartner)");
  }

  return formDB.models.NumsalPartner || formDB.model("NumsalPartner", NumsalPartnerSchema);
};
