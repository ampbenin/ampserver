const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/cms/badgeCampaignController");
const partnerCtrl = require("../../controllers/cms/badgePartnerRequestController");
const participantCtrl = require("../../controllers/cms/badgeParticipantController");
const { authLimiter } = require("../../config/rateLimit");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
});

// 🌐 Lecture publique d'une campagne publiée (page /badge/[slug])
router.get("/public/:slug", ctrl.getPublished);

// 🌐 Compteur de téléchargements de badge (sans compte, limité par IP)
router.post("/public/:slug/download", authLimiter, ctrl.trackDownload);

// 🌐 Demande de partenariat depuis la page publique (sans compte, limitée par IP)
router.post("/public/:slug/partner-requests", authLimiter, upload.single("logo"), partnerCtrl.submit);

// 🌐 Inscription à la campagne, préalable à l'affichage du badge
router.post("/public/:slug/participants", authLimiter, participantCtrl.submit);

// 🔐 Gestion réservée ADMIN (décision utilisateur : création par l'admin seulement)
const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

router.get("/partner-requests", ...requireAdmin, partnerCtrl.list);
router.patch("/partner-requests/:requestId", ...requireAdmin, partnerCtrl.review);
router.delete("/partner-requests/:requestId", ...requireAdmin, partnerCtrl.remove);
router.post("/partner-requests/send-email", ...requireAdmin, partnerCtrl.sendEmail);
router.get("/participants", ...requireAdmin, participantCtrl.list);
router.delete("/participants/:id", ...requireAdmin, participantCtrl.remove);
router.post("/participants/send-email", ...requireAdmin, participantCtrl.sendEmail);

router.get("/", ...requireAdmin, ctrl.list);
router.post("/upload-image", ...requireAdmin, upload.single("file"), ctrl.uploadImage);
router.post("/", ...requireAdmin, ctrl.create);
router.put("/:id", ...requireAdmin, ctrl.update);
router.delete("/:id", ...requireAdmin, ctrl.remove);

module.exports = router;
