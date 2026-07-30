const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/enrollmentController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

router.use(authMiddleware);

// 🔐 Apprenant
router.post("/", roleMiddleware("APPRENANT"), ctrl.enroll);
router.get("/mine", roleMiddleware("APPRENANT"), ctrl.myEnrollments);
router.patch("/:id/lessons/:lessonId/complete", roleMiddleware("APPRENANT"), ctrl.markLessonComplete);
router.patch("/:id/lessons/:lessonId/uncomplete", roleMiddleware("APPRENANT"), ctrl.unmarkLessonComplete);

// 🔐 Formateur propriétaire, ou ADMIN (CourseEditor.jsx sert aussi l'admin — voir findEditableCourse dans courseController.js pour le même contournement)
router.get("/course/:courseId", roleMiddleware("FORMATEUR", "ADMIN"), ctrl.courseProgressForTrainer);

// 🔐 Tuteur
router.get("/tutor-view", roleMiddleware("TUTEUR"), ctrl.tutorView);

module.exports = router;
