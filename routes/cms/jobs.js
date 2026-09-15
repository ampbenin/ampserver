const express = require("express");
const router = express.Router();
const makeSimpleCrud = require("../../controllers/cms/makeSimpleCrud");
const getJobPostingModel = require("../../models/cms/JobPosting");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const ctrl = makeSimpleCrud(getJobPostingModel, "Offre");
const requireEditor = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

router.get("/admin", ...requireEditor, ctrl.adminList);
router.get("/admin/:id", ...requireEditor, ctrl.adminGetById);
router.post("/admin", ...requireEditor, ctrl.create);
router.put("/admin/:id", ...requireEditor, ctrl.update);
router.delete("/admin/:id", ...requireEditor, ctrl.remove);

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
