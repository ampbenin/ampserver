/**
 * Contrôleur "Réglages du site" — logo AMP BENIN + bannière "Barre des
 * partenaires", pilotés depuis l'espace ADMIN (voir models/siteSettings.js
 * pour le contexte et les consommateurs).
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
/* Pas d'authentification — ces images sont de toute façon publiques une
   fois affichées (tableau de bord partenaire, PDF). Lu par
   PartnerDashboard.jsx et downloadImpactReport (jamais le site public). */
exports.getSiteSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ ampLogoUrl: settings.ampLogoUrl, partnersBarImageUrl: settings.partnersBarImageUrl });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : mise à jour -------------------- */
/* Accepte 0, 1 ou 2 fichiers (champs multipart "ampLogo" et/ou
   "partnersBar", voir multer.fields dans la route) — ne touche que les
   champs effectivement fournis, jamais d'écrasement accidentel de l'autre. */
exports.updateSiteSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    const files = req.files || {};

    if (files.ampLogo?.[0]) {
      const uploaded = await uploadToCloudinary(files.ampLogo[0].buffer);
      settings.ampLogoUrl = uploaded.secure_url;
    }
    if (files.partnersBar?.[0]) {
      const uploaded = await uploadToCloudinary(files.partnersBar[0].buffer);
      settings.partnersBarImageUrl = uploaded.secure_url;
    }
    settings.updatedBy = req.user.id;
    await settings.save();

    res.json({ ampLogoUrl: settings.ampLogoUrl, partnersBarImageUrl: settings.partnersBarImageUrl });
  } catch (error) {
    next(error);
  }
};
