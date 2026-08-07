/**
 * Contrôleur "Réglages du site" — logo AMP BENIN, piloté depuis l'espace
 * ADMIN (voir models/siteSettings.js pour le contexte et les
 * consommateurs ; la bannière "Barre des partenaires" a été déplacée vers
 * VolunteerProgram.partnersBarImageUrl, voir
 * controllers/volunteerProgramController.js#uploadPartnersBarImage —
 * propre à chaque programme, pas un réglage global).
 */

const streamifier = require("streamifier");
const getSiteSettingsModel = require("../models/siteSettings");
const cloudinary = require("../utils/cloudinary");

async function getOrCreateSettings() {
  const SiteSettings = getSiteSettingsModel();
  let settings = await SiteSettings.findOne();
  if (!settings) settings = await SiteSettings.create({});
  return settings;
}

const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "ong-site/site-settings", resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });

/* -------------------- Public : lecture des réglages -------------------- */
/* Pas d'authentification — cette image est de toute façon publique une
   fois affichée (tableau de bord partenaire, PDF). Lu par
   PartnerDashboard.jsx et downloadImpactReport. */
exports.getSiteSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ ampLogoUrl: settings.ampLogoUrl });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : mise à jour -------------------- */
/* Accepte 0 ou 1 fichier (champ multipart "ampLogo", voir multer.fields
   dans la route). */
exports.updateSiteSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    const files = req.files || {};

    if (files.ampLogo?.[0]) {
      const uploaded = await uploadToCloudinary(files.ampLogo[0].buffer);
      settings.ampLogoUrl = uploaded.secure_url;
    }
    settings.updatedBy = req.user.id;
    await settings.save();

    res.json({ ampLogoUrl: settings.ampLogoUrl });
  } catch (error) {
    next(error);
  }
};
