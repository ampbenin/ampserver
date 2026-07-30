const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/cms/pageController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// 🌐 Lecture publique (consommée en SSR par Astro)
router.get("/:pageKey", ctrl.getPage);

// 🔐 Écriture réservée ADMIN/EDITOR
router.put("/:pageKey", authMiddleware, roleMiddleware("ADMIN", "EDITOR"), ctrl.upsertPage);

module.exports = router;
