const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/jobApplicationController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");
const { authLimiter } = require("../config/rateLimit");

const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// 🌐 Public — schéma du formulaire de candidature d'une offre
router.get("/form/:jobPostingId", ctrl.getApplicationForm);

// 🌐 Public — postuler
router.post("/", authLimiter, ctrl.applyToJob);

// 🔐 Staff — liste + pipeline
router.get("/", ...requireStaff, ctrl.listApplications);
router.patch("/:id/review", ...requireStaff, ctrl.moveToReview);
router.patch("/:id/notes", ...requireStaff, ctrl.updateNotes);
router.patch("/:id/retain", ...requireStaff, ctrl.retainApplication);
router.patch("/:id/reject", ...requireStaff, ctrl.rejectApplication);
router.delete("/:id", ...requireStaff, ctrl.deleteApplication);

module.exports = router;
