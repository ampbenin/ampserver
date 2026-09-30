const express = require("express");
const router = express.Router();
const getJobPostingModel = require("../../models/cms/JobPosting");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// Remplace makeSimpleCrud pour ce modèle : une offre porte des droits
// délégués par personne (staffAccess) qui nécessitent une vérification par
// item, voir controllers/cms/jobPostingsController.js. Affectable à
// n'importe quel rôle sauf ADMIN depuis 2026-09-30 (EC/IS/SUPERVISEUR/
// PARTENAIRE en plus d'EDITOR, via leur propre tableau de bord — voir
// RecruitmentAssignedPanel.jsx — pas seulement /admin/dashboard) : le
// niveau route ne garde donc plus que "authentifié", la vérification fine
// par offre se fait entièrement dans le contrôleur. create/remove/
// staff-access restent réservés ADMIN aux deux niveaux (défense en
// profondeur, le contrôleur le vérifie déjà aussi).
const ctrl = require("../../controllers/cms/jobPostingsController");
const requireAuth = [authMiddleware];
const requireAdminOnly = [authMiddleware, roleMiddleware("ADMIN")];

router.get("/admin", ...requireAuth, ctrl.adminList);
router.get("/admin/:id", ...requireAuth, ctrl.adminGetById);
router.post("/admin", ...requireAdminOnly, ctrl.create);
router.put("/admin/:id", ...requireAuth, ctrl.update);
router.delete("/admin/:id", ...requireAdminOnly, ctrl.remove);
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
