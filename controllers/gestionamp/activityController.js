/**
 * Contrôleur Activity
 * Multi-tenant strict via spaceMiddleware
 */

const Activity = require("../../models/gestionamp/Activity");

/**
 * @route POST /gestionamp/api/activities
 * @desc Créer une activité (EC / IS)
 */
exports.createActivity = async (req, res) => {
  try {
    const activity = await Activity.create({
      ...req.body,
      ...req.spaceFilter,
      createdBy: req.user.id,
    });

    res.status(201).json(activity);
  } catch (error) {
    res.status(400).json({
      message: "Erreur lors de la création de l'activité",
      error: error.message,
    });
  }
};

/**
 * @route GET /gestionamp/api/activities
 * @desc Lister les activités (filtrées par espace)
 */
exports.getActivities = async (req, res) => {
  try {
    const activities = await Activity.find(req.spaceFilter)
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    res.json(activities);
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route PATCH /gestionamp/api/activities/:id/submit
 * @desc Soumettre une activité (EC / IS)
 */
exports.submitActivity = async (req, res) => {
  try {
    const activity = await Activity.findOne({
      _id: req.params.id,
      ...req.spaceFilter,
    });

    if (!activity) {
      return res.status(404).json({ message: "Activité introuvable" });
    }

    activity.status = "SUBMITTED";
    await activity.save();

    res.json({ message: "Activité soumise avec succès" });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route PATCH /gestionamp/api/activities/:id/validate
 * @desc Validation ADMIN
 */
exports.validateActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      return res.status(404).json({ message: "Activité introuvable" });
    }

    activity.status = "VALIDATED";
    await activity.save();

    res.json({ message: "Activité validée avec succès" });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};
