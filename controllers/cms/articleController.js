const getArticleModel = require("../../models/cms/Article");

/* -------------------- Public : liste des articles publiés -------------------- */
const listPublished = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const { limit = 20, tag } = req.query;

    const query = { status: "PUBLISHED" };
    if (tag) query.tags = tag;

    const items = await Article.find(query)
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(Math.min(Number(limit) || 20, 100));

    res.json({ success: true, items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : détail par slug -------------------- */
const getPublishedBySlug = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const article = await Article.findOne({
      slug: req.params.slug,
      status: "PUBLISHED",
    });

    if (!article) {
      return res.status(404).json({ message: "Article non trouvé" });
    }

    res.json(article);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : liste complète (tous statuts) -------------------- */
const adminList = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const { page = 1, limit = 25 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Article.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Article.countDocuments(),
    ]);

    res.json({ success: true, items, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : détail par id -------------------- */
const adminGetById = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ message: "Article non trouvé" });
    res.json(article);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Admin : créer -------------------- */
const create = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const article = await Article.create({
      ...req.body,
      updatedBy: req.user.id,
      ...(req.body.status === "PUBLISHED" && !req.body.publishedAt
        ? { publishedAt: new Date() }
        : {}),
    });
    res.status(201).json(article);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Ce slug existe déjà" });
    }
    next(error);
  }
};

/* -------------------- Admin : mettre à jour -------------------- */
const update = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const existing = await Article.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Article non trouvé" });

    const becomingPublished =
      req.body.status === "PUBLISHED" && existing.status !== "PUBLISHED";

    Object.assign(existing, req.body, { updatedBy: req.user.id });
    if (becomingPublished && !existing.publishedAt) {
      existing.publishedAt = new Date();
    }

    await existing.save();
    res.json(existing);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Ce slug existe déjà" });
    }
    next(error);
  }
};

/* -------------------- Admin : supprimer -------------------- */
const remove = async (req, res, next) => {
  try {
    const Article = getArticleModel();
    const deleted = await Article.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Article non trouvé" });
    res.json({ success: true, message: "Article supprimé" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listPublished,
  getPublishedBySlug,
  adminList,
  adminGetById,
  create,
  update,
  remove,
};
