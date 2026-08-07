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
 * N'a plus contenu qu'ampLogoUrl depuis le 2026-08-07 : ce modèle portait
 * aussi `partnersBarImageUrl`, mais l'utilisateur a précisé que cette
 * bannière est propre à CHAQUE PROGRAMME (seuls les partenaires suivant ce
 * programme doivent la voir), pas un réglage global — déplacée vers
 * `VolunteerProgram.partnersBarImageUrl` (voir models/volunteerProgram.js).
 *
 * Consommateurs actuels :
 * - PartnerDashboard.jsx : ampLogoUrl, à côté du logo du partenaire en en-tête.
 * - utils/partnerReportPdf.js : ampLogoUrl, sur chaque page du rapport PDF.
 */

const mongoose = require("mongoose");

const SiteSettingsSchema = new mongoose.Schema(
  {
    // Logo officiel AMP BENIN — jusqu'ici toujours codé en dur (URL
    // Cloudinary fixe dans Footer.astro/Header.astro) ; ce champ ne
    // remplace PAS ces usages existants, il alimente les NOUVEAUX endroits
    // qui ont besoin du logo AMP BENIN piloté depuis l'admin (espace
    // partenaire, PDF). Volontairement global (un seul logo AMP BENIN pour
    // tout le monde), contrairement à la bannière "Barre des partenaires"
    // qui est propre à chaque programme.
    ampLogoUrl: { type: String, default: null },

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
