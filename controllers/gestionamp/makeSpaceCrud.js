/**
 * Fabrique de contrôleurs CRUD pour les "espaces" gestionamp (Coordination
 * Communale, Institution Spécialisée) : mêmes opérations (lister/créer/
 * modifier/supprimer), seul le nom du champ métier change (commune/domaine).
 * Réservé au rôle ADMIN (voir routes).
 */
module.exports = function makeSpaceCrud(getModel, notFoundLabel, isInUse) {
  const list = async (req, res, next) => {
    try {
      const Model = getModel();
      const items = await Model.find().sort({ name: 1 });
      res.json(items);
    } catch (error) {
      next(error);
    }
  };

  const create = async (req, res, next) => {
    try {
      const Model = getModel();
      const item = await Model.create(req.body);
      res.status(201).json(item);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ message: "Ce nom existe déjà" });
      }
      next(error);
    }
  };

  const update = async (req, res, next) => {
    try {
      const Model = getModel();
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!item) return res.status(404).json({ message: `${notFoundLabel} non trouvée` });
      res.json(item);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ message: "Ce nom existe déjà" });
      }
      next(error);
    }
  };

  const remove = async (req, res, next) => {
    try {
      if (isInUse && (await isInUse(req.params.id))) {
        return res.status(409).json({
          message: `Impossible de supprimer : des comptes ou des données sont encore rattachés à cette ${notFoundLabel.toLowerCase()}`,
        });
      }

      const Model = getModel();
      const deleted = await Model.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ message: `${notFoundLabel} non trouvée` });
      res.json({ success: true, message: `${notFoundLabel} supprimée` });
    } catch (error) {
      next(error);
    }
  };

  return { list, create, update, remove };
};
