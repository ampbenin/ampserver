const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/courseController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");
const { authLimiter } = require("../../config/rateLimit");

const requireFormateur = [authMiddleware, roleMiddleware("FORMATEUR")];
// L'ADMIN peut aussi créer/gérer des programmes (voir findEditableCourse
// dans le contrôleur pour le contournement de la vérification de propriété).
const requireFormateurOrAdmin = [authMiddleware, roleMiddleware("FORMATEUR", "ADMIN")];

// 🌐 Public — catalogue des cours publiés
router.get("/", ctrl.listPublicCourses);

// 🌐 Public — schéma du formulaire de candidature + postuler (pas de compte requis)
router.get("/:id/application-form", ctrl.getApplicationForm);
router.post("/:id/apply", authLimiter, ctrl.applyToCourse);

// 🔐 Formateur — mes cours (déclaré avant "/:id" pour ne pas être capté par le paramètre générique)
router.get("/mine", ...requireFormateur, ctrl.listMyCourses);
router.post("/", ...requireFormateurOrAdmin, ctrl.createCourse);

// 🔐 Tuteur — programmes qui lui sont rattachés (à évaluer)
router.get("/to-review", authMiddleware, roleMiddleware("TUTEUR"), ctrl.listCoursesToReview);

// 🔐 Authentifié — détail complet (formateur propriétaire, admin, ou apprenant inscrit)
router.get("/:id", authMiddleware, ctrl.getCourseById);

// 🔐 Formateur propriétaire ou ADMIN — gestion du cours
router.put("/:id", ...requireFormateurOrAdmin, ctrl.updateCourseMeta);
router.delete("/:id", ...requireFormateurOrAdmin, ctrl.deleteCourse);

// 🔐 Formateur propriétaire ou ADMIN — gestion des leçons
router.post("/:id/lessons", ...requireFormateurOrAdmin, ctrl.addLesson);
router.put("/:id/lessons/reorder", ...requireFormateurOrAdmin, ctrl.reorderLessons);
router.put("/:id/lessons/:lessonId", ...requireFormateurOrAdmin, ctrl.updateLesson);
router.delete("/:id/lessons/:lessonId", ...requireFormateurOrAdmin, ctrl.deleteLesson);

// 🔐 Formateur propriétaire, tuteur rattaché, ou ADMIN — évaluation des candidatures
// (autorisation précise vérifiée dans le contrôleur via canReviewCourse)
router.get("/:id/applications", authMiddleware, ctrl.listApplications);
router.patch("/:id/applications/:applicationId/accept", authMiddleware, ctrl.acceptApplication);
router.patch("/:id/applications/:applicationId/reject", authMiddleware, ctrl.rejectApplication);

module.exports = router;
