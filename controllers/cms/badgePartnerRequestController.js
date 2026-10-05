const streamifier = require("streamifier");
const cloudinary = require("../../utils/cloudinary");
const getBadgeCampaignModel = require("../../models/cms/BadgeCampaign");
const getBadgePartnerRequestModel = require("../../models/cms/BadgePartnerRequest");
const { sendBulkEmail, escapeRegex } = require("../../utils/badgeBulkMail");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_PAGE_SIZE = 100;

const uploadLogo = (buffer) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "ong-site/badge-partner-logos", resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });

/* -------------------- Public : soumettre une demande de partenariat -------------------- */
const submit = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const BadgePartnerRequest = getBadgePartnerRequestModel();

    const campaign = await BadgeCampaign.findOne({ slug: req.params.slug, status: "PUBLISHED" }).select("_id");
    if (!campaign) return res.status(404).json({ message: "Campagne non trouvée" });

    const { structureName, email, phone, actionDescription, contribution } = req.body;
    if (!structureName?.trim() || !email?.trim() || !phone?.trim() || !actionDescription?.trim() || !contribution?.trim()) {
      return res.status(400).json({ message: "Tous les champs sont obligatoires" });
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ message: "Adresse email invalide" });
    }

    let logo = { logoUrl: null, logoPublicId: null };
    if (req.file) {
      if (!LOGO_MIME_TYPES.includes(req.file.mimetype)) {
        return res.status(400).json({ message: "Le logo doit être une image (PNG, JPG, WebP ou SVG)" });
      }
      const uploaded = await uploadLogo(req.file.buffer);
      logo = { logoUrl: uploaded.secure_url, logoPublicId: uploaded.public_id };
    }

    await BadgePartnerRequest.create({
      campaignId: campaign._id,
      structureName,
      email,
      phone,
      actionDescription,
      contribution,
      ...logo,
    });

    res.status(201).json({ message: "Votre demande a bien été envoyée. Nous revenons vers vous rapidement." });
  } catch (error) {
    next(error);
  }
};

// Filtre commun à la liste et à l'envoi groupé : recherche, campagne, statut.
const buildFilter = ({ q, campaignId, status }) => {
  const filter = {};
  if (campaignId) filter.campaignId = campaignId;
  if (status && ["PENDING", "ACCEPTED", "REJECTED"].includes(status)) filter.status = status;
  if (q?.trim()) {
    const regex = new RegExp(escapeRegex(q.trim()), "i");
    filter.$or = [{ structureName: regex }, { email: regex }, { phone: regex }];
  }
  return filter;
};

const withCampaignTitles = async (requests) => {
  const BadgeCampaign = getBadgeCampaignModel();
  const campaignIds = [...new Set(requests.map((r) => String(r.campaignId)))];
  const campaigns = await BadgeCampaign.find({ _id: { $in: campaignIds } }).select("title").lean();
  const titleById = new Map(campaigns.map((c) => [String(c._id), c.title]));
  return requests.map((r) => ({ ...r, campaignTitle: titleById.get(String(r.campaignId)) || "Campagne supprimée" }));
};

/* -------------------- Admin : lister les demandes (recherche, filtre, pagination) -------------------- */
const list = async (req, res, next) => {
  try {
    const BadgePartnerRequest = getBadgePartnerRequestModel();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || 20));
    const filter = buildFilter(req.query);

    const [total, requests] = await Promise.all([
      BadgePartnerRequest.countDocuments(filter),
      BadgePartnerRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    res.json({
      items: await withCampaignTitles(requests),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : accepter (ajoute aux partenaires) ou refuser -------------------- */
const review = async (req, res, next) => {
  try {
    const BadgePartnerRequest = getBadgePartnerRequestModel();
    const BadgeCampaign = getBadgeCampaignModel();
    const { status } = req.body;

    if (!["ACCEPTED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Statut invalide" });
    }

    const request = await BadgePartnerRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ message: "Demande introuvable" });

    if (status === "ACCEPTED" && request.status !== "ACCEPTED") {
      await BadgeCampaign.findByIdAndUpdate(request.campaignId, {
        $push: { partners: { name: request.structureName, logoUrl: request.logoUrl, websiteUrl: null } },
      });
    }

    request.status = status;
    await request.save();
    res.json(request);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : supprimer une demande -------------------- */
const remove = async (req, res, next) => {
  try {
    const BadgePartnerRequest = getBadgePartnerRequestModel();
    const deleted = await BadgePartnerRequest.findByIdAndDelete(req.params.requestId);
    if (!deleted) return res.status(404).json({ message: "Demande introuvable" });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : envoi groupé (CCI) aux structures filtrées -------------------- */
const sendEmail = async (req, res, next) => {
  try {
    const BadgePartnerRequest = getBadgePartnerRequestModel();
    const { subject, message } = req.body;
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "Objet et message sont obligatoires" });
    }

    const requests = await BadgePartnerRequest.find(buildFilter(req.body)).select("email").lean();
    if (requests.length === 0) {
      return res.status(400).json({ message: "Aucun destinataire pour ce filtre" });
    }

    const sent = await sendBulkEmail(requests.map((r) => r.email), subject.trim(), message.trim());
    res.json({ success: true, sent, message: `Email envoyé à ${sent} personne(s) en copie cachée` });
  } catch (error) {
    next(error);
  }
};

module.exports = { submit, list, review, remove, sendEmail };
