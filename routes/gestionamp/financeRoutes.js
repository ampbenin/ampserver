const express = require("express");
const router = express.Router();

// ✅ chemins corrigés
const financeController = require("../../controllers/gestionamp/financeController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");
const spaceMiddleware = require("../../middlewares/gestionamp/spaceMiddleware");

// ➕ Création finance (EC / IS)
router.post(
  "/",
  authMiddleware,
  roleMiddleware("EC", "IS"),
  spaceMiddleware,
  financeController.createFinance
);

// 📋 Listing finances
router.get(
  "/",
  authMiddleware,
  roleMiddleware("EC", "IS", "ADMIN"),
  spaceMiddleware,
  financeController.getFinances
);

// 📊 Résumé financier
router.get(
  "/summary",
  authMiddleware,
  roleMiddleware("EC", "IS", "ADMIN"),
  spaceMiddleware,
  financeController.getFinanceSummary
);

module.exports = router;
