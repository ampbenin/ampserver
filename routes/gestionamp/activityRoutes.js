const express = require("express");
const router = express.Router();

// ✅ chemins corrigés
const activityController = require("../../controllers/gestionamp/activityController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");
const spaceMiddleware = require("../../middlewares/gestionamp/spaceMiddleware");

// ➕ Création activité (EC / IS / ADMIN)
router.post(
  "/",
  authMiddleware,
  roleMiddleware("EC", "IS", "ADMIN"),
  spaceMiddleware,
  activityController.createActivity
);

// 📋 Listing activités (filtré par espace)
router.get(
  "/",
  authMiddleware,
  roleMiddleware("EC", "IS", "ADMIN"),
  spaceMiddleware,
  activityController.getActivities
);

// 📤 Soumission activité (EC / IS)
router.patch(
  "/:id/submit",
  authMiddleware,
  roleMiddleware("EC", "IS"),
  spaceMiddleware,
  activityController.submitActivity
);

// ✅ Validation activité (ADMIN)
router.patch(
  "/:id/validate",
  authMiddleware,
  roleMiddleware("ADMIN"),
  activityController.validateActivity
);

module.exports = router;
