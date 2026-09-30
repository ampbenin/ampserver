/**
 * Fabrique de contrôleurs CRUD pour les "espaces" gestionamp (Coordination
 * Communale, Institution Spécialisée) : mêmes opérations (lister/créer/
 * modifier/supprimer/désactiver/vérifier l'utilisation), seul le nom du
 * champ métier change (commune/domaine). Réservé au rôle ADMIN (voir routes).
 *
 * `getUsage(id)` (remplace l'ancien `isInUse(id)` booléen, décision
 * utilisateur 2026-09-30 : "il faut un moyen pour vérifier les données et
 * on peut supprimer. Ou désactivé") — retourne le détail de ce qui est
 * rattaché à l'espace (comptes + activités), utilisé à la fois pour
 * bloquer la suppression ET pour l'exposer via /:id/usage, consulté par
 * l'admin AVANT de décider de désactiver plutôt que de tenter de supprimer.
 */
module.exports = function makeSpaceCrud(getModel, notFoundLabel, getUsage) {
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

  /* GET /:id/usage — détail de ce qui est rattaché, consultable à tout
     moment (pas seulement après un échec de suppression). */
  const usage = async (req, res, next) => {
    try {
      const data = getUsage
        ? await getUsage(req.params.id)
        : { userCount: 0, activityCount: 0, users: [], activities: [] };
      res.json(data);
    } catch (error) {
      next(error);
    }
  };

  /* PATCH /:id/status — active/désactive l'espace (alternative à la
     suppression quand des données existent). */
  const toggleStatus = async (req, res, next) => {
    try {
      const Model = getModel();
      const item = await Model.findById(req.params.id);
      if (!item) return res.status(404).json({ message: `${notFoundLabel} non trouvée` });
      item.isActive = !item.isActive;
      await item.save();
      res.json({ success: true, isActive: item.isActive, message: `${notFoundLabel} ${item.isActive ? "activée" : "désactivée"}` });
    } catch (error) {
      next(error);
    }
  };

  const remove = async (req, res, next) => {
    try {
      if (getUsage) {
        const data = await getUsage(req.params.id);
        if (data.userCount > 0 || data.activityCount > 0) {
          return res.status(409).json({
            message: `Impossible de supprimer : ${data.userCount} compte(s) et ${data.activityCount} activité(s) encore rattaché(e)s à cette ${notFoundLabel.toLowerCase()}. Vérifiez le détail ("🔍 Vérifier"), retirez/réaffectez ces comptes, ou désactivez cet espace à la place.`,
            usage: data,
          });
        }
      }

      const Model = getModel();
      const deleted = await Model.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ message: `${notFoundLabel} non trouvée` });
      res.json({ success: true, message: `${notFoundLabel} supprimée` });
    } catch (error) {
      next(error);
    }
  };

  return { list, create, update, remove, usage, toggleStatus };
};
