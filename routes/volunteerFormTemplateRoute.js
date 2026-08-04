const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerFormTemplateController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

// 🔐 Réservé au staff (ADMIN/EDITOR) — jamais public.
router.use(authMiddleware, roleMiddleware("ADMIN", "EDITOR"));

router.get("/", ctrl.listTemplates);
router.post("/", ctrl.createTemplate);
router.patch("/:id/set-spontaneous-default", ctrl.setSpontaneousDefault);
router.delete("/:id", ctrl.deleteTemplate);

module.exports = router;
