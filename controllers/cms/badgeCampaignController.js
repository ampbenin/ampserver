const streamifier = require("streamifier");
const cloudinary = require("../../utils/cloudinary");
const getBadgeCampaignModel = require("../../models/cms/BadgeCampaign");

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const uploadTemplate = (buffer) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "ong-site/badge-campaigns", resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });

/* -------------------- Public : lire une campagne publiée -------------------- */
const getPublished = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const campaign = await BadgeCampaign.findOne({ slug: req.params.slug, status: "PUBLISHED" })
      .select("-updatedBy -templatePublicId -bannerPublicId");

    if (!campaign) return res.status(404).json({ message: "Campagne non trouvée" });
    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : lister toutes les campagnes -------------------- */
const list = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const items = await BadgeCampaign.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : uploader le gabarit (image) -------------------- */
const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });
    const uploaded = await uploadTemplate(req.file.buffer);
    res.status(201).json({ url: uploaded.secure_url, publicId: uploaded.public_id });
  } catch (error) {
    next(error);
  }
};

const pickFields = (body) => {
  const { slug, title, description, templateUrl, templatePublicId, photoZone, nameZone, colors, bannerUrl, bannerPublicId, partners, status } = body;
  return {
    ...(slug !== undefined && { slug: String(slug).trim().toLowerCase() }),
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(templateUrl !== undefined && { templateUrl }),
    ...(templatePublicId !== undefined && { templatePublicId }),
    ...(photoZone !== undefined && { photoZone }),
    ...(nameZone !== undefined && { nameZone }),
    ...(colors !== undefined && { colors }),
    ...(bannerUrl !== undefined && { bannerUrl }),
    ...(bannerPublicId !== undefined && { bannerPublicId }),
    ...(partners !== undefined && { partners }),
    ...(status !== undefined && { status }),
  };
};

/* -------------------- Admin : créer une campagne -------------------- */
const create = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const fields = pickFields(req.body);

    if (!fields.slug || !SLUG_PATTERN.test(fields.slug)) {
      return res.status(400).json({ message: "Identifiant d'URL invalide (lettres minuscules, chiffres et tirets)" });
    }

    const campaign = await BadgeCampaign.create({ ...fields, updatedBy: req.user.id });
    res.status(201).json(campaign);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Cet identifiant d'URL est déjà utilisé" });
    }
    next(error);
  }
};

/* -------------------- Admin : modifier une campagne -------------------- */
const update = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const fields = pickFields(req.body);

    if (fields.slug && !SLUG_PATTERN.test(fields.slug)) {
      return res.status(400).json({ message: "Identifiant d'URL invalide (lettres minuscules, chiffres et tirets)" });
    }

    const campaign = await BadgeCampaign.findByIdAndUpdate(
      req.params.id,
      { ...fields, updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!campaign) return res.status(404).json({ message: "Campagne non trouvée" });
    res.json(campaign);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Cet identifiant d'URL est déjà utilisé" });
    }
    next(error);
  }
};

/* -------------------- Admin : supprimer une campagne -------------------- */
const remove = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const deleted = await BadgeCampaign.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Campagne non trouvée" });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPublished, list, uploadImage, create, update, remove };
