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
// Routes /bulk AVANT /:id pour éviter qu'Express ne matche "bulk" comme un :id.
router.get("/", authMiddleware, ctrl.listApplications);
router.patch("/bulk/accept", authMiddleware, ctrl.bulkAcceptApplications);
router.patch("/bulk/reject", authMiddleware, ctrl.bulkRejectApplications);
router.delete("/bulk", authMiddleware, ctrl.deleteAllApplications);
router.patch("/:id/accept", authMiddleware, ctrl.acceptApplication);
router.patch("/:id/reject", authMiddleware, ctrl.rejectApplication);
router.delete("/:id", authMiddleware, ctrl.deleteApplication);

module.exports = router;
