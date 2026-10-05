const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/cms/badgeCampaignController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
});

// 🌐 Lecture publique d'une campagne publiée (page /badge/[slug])
router.get("/public/:slug", ctrl.getPublished);

// 🔐 Gestion réservée ADMIN (décision utilisateur : création par l'admin seulement)
const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

router.get("/", ...requireAdmin, ctrl.list);
router.post("/upload-template", ...requireAdmin, upload.single("file"), ctrl.uploadTemplateImage);
router.post("/", ...requireAdmin, ctrl.create);
router.put("/:id", ...requireAdmin, ctrl.update);
router.delete("/:id", ...requireAdmin, ctrl.remove);

module.exports = router;
