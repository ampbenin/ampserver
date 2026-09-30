const express = require("express");
const router = express.Router();

const dashboardController = require("../../controllers/gestionamp/dashboardController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// 📊 Indicateurs nationaux (ADMIN)
router.get("/stats", authMiddleware, roleMiddleware("ADMIN"), dashboardController.getAdminStats);

// 📊 Indicateurs de la coordination (EC)
router.get("/ec/stats", authMiddleware, roleMiddleware("EC"), dashboardController.getEcStats);

// 📊 Indicateurs de l'institution (IS)
router.get("/is/stats", authMiddleware, roleMiddleware("IS"), dashboardController.getIsStats);

module.exports = router;
