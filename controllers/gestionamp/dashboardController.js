/**
 * Statistiques des tableaux de bord ADMIN/EC/IS — GESTION AMP (DB2)
 * N'existait pas du tout côté serveur jusqu'ici : AdminStats.jsx/ECStats.jsx/
 * ISStats.jsx appelaient /api/dashboard/... (chemin en double, corrigé côté
 * frontend) vers un endpoint jamais construit. Ajouté suite à l'audit
 * "qu'est-ce qui manque pour que la gestion des IS marche" (2026-09-30).
 *
 * Statuts Activity : DRAFT (planifiée, pas encore soumise) → SUBMITTED (en
 * attente de validation ADMIN) → VALIDATED (validée/réalisée). Même mapping
 * pour les 3 tableaux de bord : planned=DRAFT, pending=SUBMITTED,
 * completed=VALIDATED.
 */

const getActivityModel = require("../../models/gestionamp/Activity");
const getFinanceModel = require("../../models/gestionamp/Finance");
const getCoordinationModel = require("../../models/gestionamp/CoordinationCommunale");
const getInstitutionModel = require("../../models/gestionamp/InstitutionSpecialisee");
const getUserModel = require("../../models/gestionamp/User");

const sumByType = (finances) => {
  const totalIncomes = finances.filter((f) => f.type === "INCOME").reduce((s, f) => s + f.amount, 0);
  const totalExpenses = finances.filter((f) => f.type === "EXPENSE").reduce((s, f) => s + f.amount, 0);
  return { totalIncomes, totalExpenses, balance: totalIncomes - totalExpenses };
};

/* -------------------- ADMIN : indicateurs nationaux -------------------- */
exports.getAdminStats = async (req, res, next) => {
  try {
    const { year } = req.query;
    const Activity = getActivityModel();
    const Coordination = getCoordinationModel();
    const Institution = getInstitutionModel();
    const User = getUserModel();

    const dateFilter = year
      ? { createdAt: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31T23:59:59.999`) } }
      : {};

    const [coordinations, institutions, ec, is, planned, pending, completed] = await Promise.all([
      Coordination.countDocuments(),
      Institution.countDocuments(),
      User.countDocuments({ role: "EC" }),
      User.countDocuments({ role: "IS" }),
      Activity.countDocuments({ ...dateFilter, status: "DRAFT" }),
      Activity.countDocuments({ ...dateFilter, status: "SUBMITTED" }),
      Activity.countDocuments({ ...dateFilter, status: "VALIDATED" }),
    ]);

    res.json({ coordinations, institutions, ec, is, activities: { planned, pending, completed } });
  } catch (error) {
    next(error);
  }
};

/* -------------------- EC : indicateurs de la coordination -------------------- */
exports.getEcStats = async (req, res, next) => {
  try {
    const coordinationCommunaleId = req.user.coordinationCommunaleId;
    if (!coordinationCommunaleId) {
      return res.status(403).json({ message: "Accès refusé : aucune coordination communale associée" });
    }

    const Activity = getActivityModel();
    const Finance = getFinanceModel();
    const Coordination = getCoordinationModel();

    const [coordination, planned, completed, finances] = await Promise.all([
      Coordination.findById(coordinationCommunaleId),
      Activity.countDocuments({ coordinationCommunaleId, status: "DRAFT" }),
      Activity.countDocuments({ coordinationCommunaleId, status: "VALIDATED" }),
      Finance.find({ coordinationCommunaleId }),
    ]);

    res.json({
      coordinationName: coordination?.name || "",
      activities: { planned, completed },
      finance: sumByType(finances),
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- IS : indicateurs de l'institution -------------------- */
/* ISStats.jsx attendait historiquement `activitiesByDomain` (compte par
   domaine) mais Activity n'a aucun champ "domaine" (seule l'institution
   elle-même en a un, dans InstitutionSpecialisee) — regrouper les activités
   d'UNE SEULE institution par domaine n'a donc pas de sens (elles
   partagent toutes le même). Remplacé par le même mapping planned/completed
   qu'EC (donnée réelle et cohérente entre les 3 tableaux de bord) ; voir le
   correctif correspondant dans ISStats.jsx. */
exports.getIsStats = async (req, res, next) => {
  try {
    const institutionSpecialiseeId = req.user.institutionSpecialiseeId;
    if (!institutionSpecialiseeId) {
      return res.status(403).json({ message: "Accès refusé : aucune institution spécialisée associée" });
    }

    const Activity = getActivityModel();
    const Finance = getFinanceModel();
    const Institution = getInstitutionModel();

    const [institution, planned, completed, finances] = await Promise.all([
      Institution.findById(institutionSpecialiseeId),
      Activity.countDocuments({ institutionSpecialiseeId, status: "DRAFT" }),
      Activity.countDocuments({ institutionSpecialiseeId, status: "VALIDATED" }),
      Finance.find({ institutionSpecialiseeId }),
    ]);

    res.json({
      institutionName: institution?.name || "",
      activities: { planned, completed },
      finance: sumByType(finances),
    });
  } catch (error) {
    next(error);
  }
};
