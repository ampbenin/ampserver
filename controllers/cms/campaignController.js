const getCampaignModel = require("../../models/cms/Campaign");

/* -------------------- Public : lire une campagne -------------------- */
const getCampaign = async (req, res, next) => {
  try {
    const Campaign = getCampaignModel();
    const campaign = await Campaign.findOne({ slug: req.params.slug });

    if (!campaign) {
      return res.status(404).json({ message: "Campagne non trouvée" });
    }

    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : créer/mettre à jour une campagne -------------------- */
const upsertCampaign = async (req, res, next) => {
  try {
    const Campaign = getCampaignModel();
    const { slug } = req.params;
    const { sections, dailyArticles, status } = req.body;

    const campaign = await Campaign.findOneAndUpdate(
      { slug },
      {
        slug,
        ...(sections !== undefined && { sections }),
        ...(dailyArticles !== undefined && { dailyArticles }),
        ...(status !== undefined && { status }),
        updatedBy: req.user.id,
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

module.exports = { getCampaign, upsertCampaign };
