const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerApplicationController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");
const volunteerAuthMiddleware = require("../middlewares/volunteer/authMiddleware");
const { authLimiter } = require("../config/rateLimit");

const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// 🌐 Public — schéma du formulaire de candidature spontanée
router.get("/spontaneous-form", ctrl.getSpontaneousForm);

// 🌐 Public — postuler (à un programme, ou spontanément si programId absent)
router.post("/", authLimiter, ctrl.applyToProgram);

// 🔐 Volontaire connecté ("Mon espace") — ses propres candidatures
router.get("/mine", volunteerAuthMiddleware, ctrl.listMyApplications);

// 🔐 Staff — modération (ADMIN/EDITOR pour tout ; un reviewer rattaché à un
// programme précis peut aussi consulter ses candidatures, voir le contrôleur)
router.get("/", authMiddleware, ctrl.listApplications);
router.patch("/:id/accept", authMiddleware, ctrl.acceptApplication);
router.patch("/:id/reject", authMiddleware, ctrl.rejectApplication);
router.delete("/:id", authMiddleware, ctrl.deleteApplication);

module.exports = router;
