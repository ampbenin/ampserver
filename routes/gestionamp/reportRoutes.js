const express = require("express");
const router = express.Router();

// ✅ chemins corrigés
const reportController = require("../../controllers/gestionamp/reportController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");
const spaceMiddleware = require("../../middlewares/gestionamp/spaceMiddleware");

// 🧾 Générer un rapport (EC / IS)
router.post(
  "/",
  authMiddleware,
  roleMiddleware("EC", "IS"),
  spaceMiddleware,
  reportController.generateReport
);

// 📋 Lister les rapports (par espace)
router.get(
  "/",
  authMiddleware,
  roleMiddleware("EC", "IS", "ADMIN"),
  spaceMiddleware,
  reportController.getReports
);

// ✅ Validation rapport (ADMIN)
router.put(
  "/:id/validate",
  authMiddleware,
  roleMiddleware("ADMIN"),
  reportController.validateReport
);

// 📥 Télécharger le rapport (après validation)
router.get(
  "/:id/download",
  authMiddleware,
  roleMiddleware("EC", "IS", "ADMIN"),
  spaceMiddleware,
  reportController.downloadReport
);

module.exports = router;
