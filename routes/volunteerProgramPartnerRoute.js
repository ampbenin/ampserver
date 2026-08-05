const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerProgramPartnerController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const requirePartner = [authMiddleware, roleMiddleware("PARTENAIRE")];
const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// 🔐 Partenaire connecté
router.get("/my-programs", ...requirePartner, ctrl.listMyPartnerPrograms);
router.get("/programs/:programId/stats", ...requirePartner, ctrl.getPartnerProgramStats);
router.post("/programs/:programId/comments", ...requirePartner, ctrl.submitPartnerComment);

// 🔐 Staff (ADMIN/EDITOR uniquement — jamais les superviseurs)
router.get("/programs/:programId/comments", ...requireStaff, ctrl.listPartnerComments);

module.exports = router;
