const getBadgeCampaignModel = require("../../models/cms/BadgeCampaign");
const getBadgeParticipantModel = require("../../models/cms/BadgeParticipant");
const { sendBulkEmail, escapeRegex } = require("../../utils/badgeBulkMail");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PAGE_SIZE = 100;

/* -------------------- Public : rejoindre une campagne (avant d'obtenir le badge) -------------------- */
const submit = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const BadgeParticipant = getBadgeParticipantModel();

    const campaign = await BadgeCampaign.findOne({ slug: req.params.slug, status: "PUBLISHED" }).select("_id");
    if (!campaign) return res.status(404).json({ message: "Campagne non trouvée" });

    const fields = {
      name: req.body.name?.trim() || "",
      email: req.body.email?.trim() || "",
      whatsapp: req.body.whatsapp?.trim() || "",
      countryCity: req.body.countryCity?.trim() || "",
    };
    if (!Object.values(fields).some(Boolean)) {
      return res.status(400).json({ message: "Renseignez au moins un champ, ou passez cette étape" });
    }
    if (fields.email && !EMAIL_PATTERN.test(fields.email)) {
      return res.status(400).json({ message: "Adresse email invalide" });
    }

    await BadgeParticipant.create({ campaignId: campaign._id, ...fields });

    res.status(201).json({ message: "Merci ! Votre badge est prêt." });
  } catch (error) {
    next(error);
  }
};

// Filtre commun à la liste et à l'envoi groupé : recherche + campagne.
const buildFilter = ({ q, campaignId }) => {
  const filter = {};
  if (campaignId) filter.campaignId = campaignId;
  if (q?.trim()) {
    const regex = new RegExp(escapeRegex(q.trim()), "i");
    filter.$or = [{ name: regex }, { email: regex }, { whatsapp: regex }, { countryCity: regex }];
  }
  return filter;
};

const withCampaignTitles = async (participants) => {
  const BadgeCampaign = getBadgeCampaignModel();
  const campaignIds = [...new Set(participants.map((p) => String(p.campaignId)))];
  const campaigns = await BadgeCampaign.find({ _id: { $in: campaignIds } }).select("title").lean();
  const titleById = new Map(campaigns.map((c) => [String(c._id), c.title]));
  return participants.map((p) => ({ ...p, campaignTitle: titleById.get(String(p.campaignId)) || "Campagne supprimée" }));
};

/* -------------------- Admin : lister les inscrits (recherche, filtre, pagination) -------------------- */
const list = async (req, res, next) => {
  try {
    const BadgeParticipant = getBadgeParticipantModel();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || 20));
    const filter = buildFilter(req.query);

    const [total, participants] = await Promise.all([
      BadgeParticipant.countDocuments(filter),
      BadgeParticipant.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    res.json({
      items: await withCampaignTitles(participants),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : supprimer une inscription -------------------- */
const remove = async (req, res, next) => {
  try {
    const BadgeParticipant = getBadgeParticipantModel();
    const deleted = await BadgeParticipant.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Inscription introuvable" });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : envoi groupé (CCI) à toutes les personnes filtrées -------------------- */
const sendEmail = async (req, res, next) => {
  try {
    const BadgeParticipant = getBadgeParticipantModel();
    const { subject, message, q, campaignId } = req.body;
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "Objet et message sont obligatoires" });
    }

    const participants = await BadgeParticipant.find(buildFilter({ q, campaignId })).select("email").lean();
    if (participants.length === 0) {
      return res.status(400).json({ message: "Aucun destinataire pour ce filtre" });
    }

    const sent = await sendBulkEmail(participants.map((p) => p.email), subject.trim(), message.trim());
    res.json({ success: true, sent, message: `Email envoyé à ${sent} personne(s) en copie cachée` });
  } catch (error) {
    next(error);
  }
};

module.exports = { submit, list, remove, sendEmail };
