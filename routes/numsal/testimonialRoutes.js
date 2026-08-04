const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../../controllers/numsal/testimonialController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");
const { authLimiter } = require("../../config/rateLimit");

const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

// Ce point d'entrée est ouvert sans compte (contrairement à l'upload de logo
// partenaire, réservé ADMIN) — fileFilter en garde-fou supplémentaire pour
// rejeter d'emblée tout fichier qui n'est pas une image, en plus de la
// limite de débit authLimiter appliquée sur la route.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"));
  },
});

// 🌐 Public — avis publiés (page d'accueil) + soumission d'un nouvel avis
router.get("/", ctrl.listPublishedTestimonials);
router.post("/", authLimiter, ctrl.submitTestimonial);
router.post("/upload-photo", authLimiter, upload.single("file"), ctrl.uploadPhoto);

// 🔐 ADMIN — modération
// (routes fixes déclarées avant "/:id" pour ne pas être captées par le paramètre générique)
router.get("/admin/all", ...requireAdmin, ctrl.listAllTestimonials);
router.put("/reorder", ...requireAdmin, ctrl.reorderTestimonials);
router.patch("/:id/publish", ...requireAdmin, ctrl.publishTestimonial);
router.patch("/:id/reject", ...requireAdmin, ctrl.rejectTestimonial);
router.delete("/:id", ...requireAdmin, ctrl.deleteTestimonial);

module.exports = router;
