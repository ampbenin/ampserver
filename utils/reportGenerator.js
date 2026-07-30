const Activity = require("../models/Activity");
const Finance = require("../models/Finance");

/**
 * Génère les données du rapport (JSON)
 */
exports.generateReportData = async ({ year, spaceFilter }) => {
  const start = new Date(`${year}-01-01`);
  const end = new Date(`${year}-12-31`);

  const activities = await Activity.find({
    ...spaceFilter,
    createdAt: { $gte: start, $lte: end },
  });

  const finances = await Finance.find({
    ...spaceFilter,
    createdAt: { $gte: start, $lte: end },
  });

  const totalIncome = finances
    .filter((f) => f.type === "INCOME")
    .reduce((s, f) => s + f.amount, 0);

  const totalExpense = finances
    .filter((f) => f.type === "EXPENSE")
    .reduce((s, f) => s + f.amount, 0);

  return {
    activitiesCount: activities.length,
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
  };
};
