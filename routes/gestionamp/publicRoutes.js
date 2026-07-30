const express = require("express");
const router = express.Router();

// ✅ chemins corrigés
const publicController = require("../../controllers/gestionamp/publicController");
const publicApiMiddleware = require("../../middlewares/gestionamp/publicApiMiddleware");

// 🔐 Toutes les routes publiques sont protégées par clé API
router.use(publicApiMiddleware);

// 📊 Accueil – statistiques globales
router.get("/stats", publicController.getGlobalStats);

// 📣 Page Actions – activités validées
router.get("/activities", publicController.getPublicActivities);

// 📈 Page Résultats – rapports validés
router.get("/reports", publicController.getValidatedReports);

module.exports = router;
