/**
 * Contrôleur Finance
 * Hérite de l'isolation par espace
 *
 * Bug corrigé (2026-09-30, audit "gestion des IS") : même erreur que
 * activityController.js — `Finance`/`Activity` étaient les loaders lazy
 * jamais invoqués, jamais le modèle Mongoose lui-même.
 */

const getFinanceModel = require("../../models/gestionamp/Finance");
const getActivityModel = require("../../models/gestionamp/Activity");

/**
 * @route POST /gestionamp/api/finances
 * @desc Créer une entrée / sortie financière
 */
exports.createFinance = async (req, res) => {
  try {
    const { activityId, type, amount, description } = req.body;
    const Activity = getActivityModel();
    const Finance = getFinanceModel();

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
    const Finance = getFinanceModel();
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
 *
 * Bug corrigé (2026-09-30) : renvoyait `totalIncome`/`totalExpense`
 * (singulier) alors que les 3 widgets qui consomment cet endpoint
 * (FinanceGlobalSummary.jsx ADMIN, FinanceSummary.jsx EC,
 * InstitutionFinanceSummary.jsx IS) lisent tous `totalIncomes`/
 * `totalExpenses` (pluriel) — masqué jusqu'ici par le bug de loader lazy
 * qui empêchait cet endpoint de répondre quoi que ce soit.
 */
exports.getFinanceSummary = async (req, res) => {
  try {
    const Finance = getFinanceModel();
    const finances = await Finance.find(req.spaceFilter);

    const totalIncomes = finances
      .filter((f) => f.type === "INCOME")
      .reduce((sum, f) => sum + f.amount, 0);

    const totalExpenses = finances
      .filter((f) => f.type === "EXPENSE")
      .reduce((sum, f) => sum + f.amount, 0);

    const balance = totalIncomes - totalExpenses;

    res.json({
      totalIncomes,
      totalExpenses,
      balance,
    });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};
