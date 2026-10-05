const getBadgeCampaignModel = require("../../models/cms/BadgeCampaign");
const getBadgeParticipantModel = require("../../models/cms/BadgeParticipant");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------- Public : rejoindre une campagne (avant d'obtenir le badge) -------------------- */
const submit = async (req, res, next) => {
  try {
    const BadgeCampaign = getBadgeCampaignModel();
    const BadgeParticipant = getBadgeParticipantModel();

    const campaign = await BadgeCampaign.findOne({ slug: req.params.slug, status: "PUBLISHED" }).select("_id");
    if (!campaign) return res.status(404).json({ message: "Campagne non trouvée" });

    const { name, email, whatsapp, countryCity } = req.body;
    if (!name?.trim() || !email?.trim() || !whatsapp?.trim() || !countryCity?.trim()) {
      return res.status(400).json({ message: "Tous les champs sont obligatoires" });
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ message: "Adresse email invalide" });
    }

    await BadgeParticipant.create({
      campaignId: campaign._id,
      name,
      email,
      whatsapp,
      countryCity,
    });

    res.status(201).json({ message: "Merci ! Votre badge est prêt." });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : lister les personnes ayant rejoint les campagnes -------------------- */
const list = async (req, res, next) => {
  try {
    const BadgeParticipant = getBadgeParticipantModel();
    const BadgeCampaign = getBadgeCampaignModel();
    const participants = await BadgeParticipant.find().sort({ createdAt: -1 }).lean();

    const campaignIds = [...new Set(participants.map((p) => String(p.campaignId)))];
    const campaigns = await BadgeCampaign.find({ _id: { $in: campaignIds } }).select("title").lean();
    const titleById = new Map(campaigns.map((c) => [String(c._id), c.title]));

    res.json(participants.map((p) => ({ ...p, campaignTitle: titleById.get(String(p.campaignId)) || "Campagne supprimée" })));
  } catch (error) {
    next(error);
  }
};

module.exports = { submit, list };
