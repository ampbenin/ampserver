const getCmsPageModel = require("../../models/cms/CmsPage");

/* -------------------- Lire une page singleton -------------------- */
const getPage = async (req, res, next) => {
  try {
    const CmsPage = getCmsPageModel();
    const page = await CmsPage.findOne({ pageKey: req.params.pageKey });

    if (!page) {
      return res.status(404).json({ message: "Page non trouvée" });
    }

    res.json(page);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Créer/mettre à jour une page singleton -------------------- */
const upsertPage = async (req, res, next) => {
  try {
    const CmsPage = getCmsPageModel();
    const { pageKey } = req.params;
    const { zones, status } = req.body;

    const page = await CmsPage.findOneAndUpdate(
      { pageKey },
      {
        pageKey,
        ...(zones !== undefined && { zones }),
        ...(status !== undefined && { status }),
        updatedBy: req.user.id,
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(page);
  } catch (error) {
    next(error);
  }
};

module.exports = { getPage, upsertPage };
