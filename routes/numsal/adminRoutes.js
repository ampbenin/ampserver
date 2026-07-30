const express = require("express");
const router = express.Router();

const adminController = require("../../controllers/numsal/adminController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// 🔐 Toutes les routes sont ADMIN uniquement
router.use(authMiddleware, roleMiddleware("ADMIN"));

router.get("/stats", adminController.getStats);

router.post("/users", adminController.createStaffUser);
router.get("/users", adminController.listUsers);
router.patch("/users/:id", adminController.updateUser);
router.patch("/users/:id/status", adminController.toggleUserStatus);
router.post("/users/:id/reset-password", adminController.resetUserPassword);
router.delete("/users/:id", adminController.deleteUser);
router.patch("/tutors/:id/assign-learners", adminController.assignLearnersToTutor);

router.get("/courses", adminController.listAllCourses);
router.patch("/courses/:id/assign-tutors", adminController.assignTutorsToCourse);

module.exports = router;
