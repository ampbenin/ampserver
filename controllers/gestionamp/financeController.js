/**
 * Contrôleur Finance
 * Hérite de l'isolation par espace
 */

const Finance = require("../../models/gestionamp/Finance");
const Activity = require("../../models/gestionamp/Activity");

/**
 * @route POST /gestionamp/api/finances
 * @desc Créer une entrée / sortie financière
 */
exports.createFinance = async (req, res) => {
  try {
    const { activityId, type, amount, description } = req.body;

    // Vérifier que l'activité existe et appartient à l'espace
    const activity = await Activity.findOne({
      _id: activityId,
      ...req.spaceFilter,
    });

    if (!activity) {
      return res.status(404).json({
        message: "Activité introuvable ou hors de votre espace",
      });
    }

    const finance = await Finance.create({
      activityId,
      type,
      amount,
      description,
      coordinationCommunaleId: activity.coordinationCommunaleId,
      institutionSpecialiseeId: activity.institutionSpecialiseeId,
      createdBy: req.user.id,
    });

    res.status(201).json(finance);
  } catch (error) {
    res.status(400).json({
      message: "Erreur lors de l'enregistrement financier",
      error: error.message,
    });
  }
};

/**
 * @route GET /gestionamp/api/finances
 * @desc Lister les finances (par espace)
 */
exports.getFinances = async (req, res) => {
  try {
    const finances = await Finance.find(req.spaceFilter)
      .populate("activityId", "title status")
      .sort({ createdAt: -1 });

    res.json(finances);
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route GET /gestionamp/api/finances/summary
 * @desc Résumé financier (totaux + solde)
 */
exports.getFinanceSummary = async (req, res) => {
  try {
    const finances = await Finance.find(req.spaceFilter);

    const totalIncome = finances
      .filter((f) => f.type === "INCOME")
      .reduce((sum, f) => sum + f.amount, 0);

    const totalExpense = finances
      .filter((f) => f.type === "EXPENSE")
      .reduce((sum, f) => sum + f.amount, 0);

    const balance = totalIncome - totalExpense;

    res.json({
      totalIncome,
      totalExpense,
      balance,
    });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};
