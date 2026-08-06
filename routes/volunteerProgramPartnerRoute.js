const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../controllers/volunteerProgramPartnerController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const requirePartner = [authMiddleware, roleMiddleware("PARTENAIRE")];
const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// Même limite que l'upload de preuve de tâche (volunteerTaskRoute.js) :
// 10 Mo, images uniquement, rejeté d'emblée sinon.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// 🔐 Partenaire connecté
router.get("/my-programs", ...requirePartner, ctrl.listMyPartnerPrograms);
router.get("/programs/:programId/stats", ...requirePartner, ctrl.getPartnerProgramStats);
router.get("/programs/:programId/applications", ...requirePartner, ctrl.listPartnerApplications);
router.get("/programs/:programId/report.pdf", ...requirePartner, ctrl.downloadImpactReport);
router.get("/programs/:programId/my-comments", ...requirePartner, ctrl.listMyComments);
router.post("/programs/:programId/comments", ...requirePartner, ctrl.submitPartnerComment);
router.post("/me/logo", ...requirePartner, upload.single("file"), ctrl.uploadPartnerLogo);

// 🔐 Staff (ADMIN/EDITOR uniquement — jamais les superviseurs)
router.get("/programs/:programId/comments", ...requireStaff, ctrl.listPartnerComments);
router.patch("/comments/:commentId/reply", ...requireStaff, ctrl.replyToComment);

// 🔐 Staff — suivi d'activité des partenaires (connexion + actions)
router.get("/admin/activity-summary", ...requireStaff, ctrl.getPartnerActivitySummary);
router.get("/admin/partners/:partnerId/activity", ...requireStaff, ctrl.getPartnerActivityTimeline);

module.exports = router;
