const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/cms/campaignController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// 🌐 Lecture publique (consommée en SSR par Astro)
router.get("/:slug", ctrl.getCampaign);

// 🔐 Écriture réservée ADMIN/EDITOR
router.put("/:slug", authMiddleware, roleMiddleware("ADMIN", "EDITOR"), ctrl.upsertCampaign);

module.exports = router;
