/**
 * Fabrique de contrôleurs CRUD pour les collections CMS "simples" (Action,
 * JobPosting...) : pas de page de détail par slug, juste une liste publique
 * triée + un CRUD admin complet par id.
 */
module.exports = function makeSimpleCrud(getModel, notFoundLabel) {
  const listPublished = async (req, res, next) => {
    try {
      const Model = getModel();
      const items = await Model.find({ status: "PUBLISHED" }).sort({ order: 1, createdAt: -1 });
      res.json({ success: true, items });
    } catch (error) {
      next(error);
    }
  };

  const adminList = async (req, res, next) => {
    try {
      const Model = getModel();
      const items = await Model.find().sort({ order: 1, createdAt: -1 });
      res.json({ success: true, items });
    } catch (error) {
      next(error);
    }
  };

  const adminGetById = async (req, res, next) => {
    try {
      const Model = getModel();
      const item = await Model.findById(req.params.id);
      if (!item) return res.status(404).json({ message: `${notFoundLabel} non trouvé` });
      res.json(item);
    } catch (error) {
      next(error);
    }
  };

  const create = async (req, res, next) => {
    try {
      const Model = getModel();
      const item = await Model.create({ ...req.body, updatedBy: req.user.id });
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  };

  const update = async (req, res, next) => {
    try {
      const Model = getModel();
      const item = await Model.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedBy: req.user.id },
        { new: true, runValidators: true }
      );
      if (!item) return res.status(404).json({ message: `${notFoundLabel} non trouvé` });
      res.json(item);
    } catch (error) {
      next(error);
    }
  };

  const remove = async (req, res, next) => {
    try {
      const Model = getModel();
      const deleted = await Model.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ message: `${notFoundLabel} non trouvé` });
      res.json({ success: true, message: `${notFoundLabel} supprimé` });
    } catch (error) {
      next(error);
    }
  };

  return { listPublished, adminList, adminGetById, create, update, remove };
};
