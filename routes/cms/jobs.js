const express = require("express");
const router = express.Router();
const getJobPostingModel = require("../../models/cms/JobPosting");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// Remplace makeSimpleCrud pour ce modèle : une offre porte des droits
// délégués par personne (staffAccess) qui nécessitent une vérification par
// item, voir controllers/cms/jobPostingsController.js. Le contrôleur
// distingue ADMIN (create/remove/setStaffAccess) de "canEditForm" (update) —
// roleMiddleware ici ne fait que garder EC/IS/SUPERVISEUR/PARTENAIRE hors
// du panneau admin, même découpage que routes/volunteerProgramRoute.js.
const ctrl = require("../../controllers/cms/jobPostingsController");
const requireEditor = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];
const requireAdminOnly = [authMiddleware, roleMiddleware("ADMIN")];

router.get("/admin", ...requireEditor, ctrl.adminList);
router.get("/admin/:id", ...requireEditor, ctrl.adminGetById);
router.post("/admin", ...requireEditor, ctrl.create);
router.put("/admin/:id", ...requireEditor, ctrl.update);
router.delete("/admin/:id", ...requireEditor, ctrl.remove);
router.patch("/admin/:id/staff-access", ...requireAdminOnly, ctrl.setStaffAccess);

// Liste publique : ne sert pas les offres dont la date limite est dépassée
// (le CRUD admin, lui, continue de toutes les montrer — une offre expirée
// n'est pas supprimée automatiquement, juste retirée de la page publique).
router.get("/", async (req, res, next) => {
  try {
    const Model = getJobPostingModel();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const items = await Model.find({
      status: "PUBLISHED",
      $or: [{ deadline: null }, { deadline: { $gte: startOfToday } }],
    }).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, items });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
