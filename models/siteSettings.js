/**
 * Modèle SiteSettings — réglages globaux du site, gérés depuis l'espace
 * ADMIN (nouveau, 2026-08-07). Singleton (un seul document, toujours
 * retrouvé via findOne() / créé à la volée s'il n'existe pas encore — voir
 * controllers/siteSettingsController.js#getOrCreateSettings).
 *
 * Vit sur global.formDB, comme GestionAmpUser/VolunteerProgram — c'est un
 * réglage administratif, pas une donnée d'identité volontaire (qui vit sur
 * la connexion par défaut).
 *
 * Consommateurs actuels — l'espace PARTENAIRE uniquement, jamais le site
 * public (correction du 2026-08-07 : un premier placement de la barre des
 * partenaires dans le footer public a été retiré sur demande explicite de
 * l'utilisateur, "ça concerne uniquement l'espace du partenaire") :
 * - PartnerDashboard.jsx : ampLogoUrl (à côté du logo du partenaire, en
 *   en-tête) + partnersBarImageUrl (tout en bas de CE tableau de bord).
 * - utils/partnerReportPdf.js : les deux, sur chaque page du rapport PDF.
 */

const mongoose = require("mongoose");

const SiteSettingsSchema = new mongoose.Schema(
  {
    // Logo officiel AMP BENIN — jusqu'ici toujours codé en dur (URL
    // Cloudinary fixe dans Footer.astro/Header.astro) ; ce champ ne
    // remplace PAS ces usages existants, il alimente les NOUVEAUX endroits
    // qui ont besoin du logo AMP BENIN piloté depuis l'admin (espace
    // partenaire, PDF).
    ampLogoUrl: { type: String, default: null },

    // Bannière "Barre des partenaires" — UNE seule image composée par
    // l'ADMIN (pas une génération dynamique à partir des logos de chaque
    // partenaire), affichée en pleine largeur tout en bas de l'espace
    // PARTENAIRE (PartnerDashboard.jsx) — jamais le site public.
    partnersBarImageUrl: { type: String, default: null },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "GestionAmpUser", default: null },
  },
  { timestamps: true }
);

module.exports = function getSiteSettingsModel() {
  const formDB = global.formDB;

  if (!formDB) {
    throw new Error("❌ formDB non initialisée (SiteSettings)");
  }

  return formDB.models.SiteSettings || formDB.model("SiteSettings", SiteSettingsSchema);
};
