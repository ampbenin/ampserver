const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/testimonialController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");
const { authLimiter } = require("../../config/rateLimit");

const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

// 🌐 Public — avis publiés (page d'accueil) + soumission d'un nouvel avis
router.get("/", ctrl.listPublishedTestimonials);
router.post("/", authLimiter, ctrl.submitTestimonial);

// 🔐 ADMIN — modération
// (routes fixes déclarées avant "/:id" pour ne pas être captées par le paramètre générique)
router.get("/admin/all", ...requireAdmin, ctrl.listAllTestimonials);
router.put("/reorder", ...requireAdmin, ctrl.reorderTestimonials);
router.patch("/:id/publish", ...requireAdmin, ctrl.publishTestimonial);
router.patch("/:id/reject", ...requireAdmin, ctrl.rejectTestimonial);
router.delete("/:id", ...requireAdmin, ctrl.deleteTestimonial);

module.exports = router;
