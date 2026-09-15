const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../controllers/jobApplicationController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");
const { authLimiter } = require("../config/rateLimit");

const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// Point d'entrée public sans compte (comme numsal/testimonialRoutes.js
// #upload-photo) — pas de fileFilter mimetype ici : un champ FILE accepte
// n'importe quel type de document, configurable par champ côté admin
// (validation.allowedFileTypes, imposé côté client). Le plafond ci-dessous
// est un garde-fou serveur global, pas le maximum annoncé au candidat.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo
});

// 🌐 Public — schéma du formulaire de candidature d'une offre
router.get("/form/:jobPostingId", ctrl.getApplicationForm);

// 🌐 Public — upload d'une pièce jointe (champ FILE) avant soumission
router.post("/upload-file", authLimiter, upload.single("file"), ctrl.uploadApplicationFile);

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
