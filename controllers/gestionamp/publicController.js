const Activity = require("../../models/gestionamp/Activity");
const Finance = require("../../models/gestionamp/Finance");
const Report = require("../../models/gestionamp/Report");

/**
 * Statistiques globales (Accueil)
 * Données VALIDÉES uniquement
 */
exports.getGlobalStats = async (req, res) => {
  const activities = await Activity.find({ status: "VALIDATED" });
  const finances = await Finance.find();

  const totalIncome = finances
    .filter((f) => f.type === "INCOME")
    .reduce((s, f) => s + f.amount, 0);

  const totalExpense = finances
    .filter((f) => f.type === "EXPENSE")
    .reduce((s, f) => s + f.amount, 0);

  res.json({
    activitiesValidated: activities.length,
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
  });
};

/**
 * Actions / Activités publiques
 * Activités VALIDÉES uniquement
 */
exports.getPublicActivities = async (req, res) => {
  const activities = await Activity.find({ status: "VALIDATED" })
    .select("title description createdAt")
    .sort({ createdAt: -1 });

  res.json(activities);
};

/**
 * Résultats / Rapports validés
 * Rapports VALIDÉS uniquement
 */
exports.getValidatedReports = async (req, res) => {
  const reports = await Report.find({ status: "VALIDATED" })
    .select("year createdAt")
    .sort({ year: -1 });

  res.json(reports);
};
