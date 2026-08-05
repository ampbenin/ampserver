const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/volunteerTaskController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const volunteerAuthMiddleware = require("../middlewares/volunteer/authMiddleware");

// 🔐 Volontaire connecté ("Mon espace")
router.post("/submissions", volunteerAuthMiddleware, ctrl.submitTask);
router.get("/my-progress/:programId", volunteerAuthMiddleware, ctrl.getMyProgramProgress);

// 🔐 Staff — modération + suivi (autorisation fine via canReviewProgram dans le contrôleur)
router.get("/submissions", authMiddleware, ctrl.listSubmissions);
router.patch("/submissions/:id/accept", authMiddleware, ctrl.approveSubmission);
router.patch("/submissions/:id/reject", authMiddleware, ctrl.rejectSubmission);
router.get("/programs/:programId/progress", authMiddleware, ctrl.listProgramProgress);

module.exports = router;
