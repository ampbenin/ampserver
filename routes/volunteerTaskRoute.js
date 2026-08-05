const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../controllers/volunteerTaskController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const volunteerAuthMiddleware = require("../middlewares/volunteer/authMiddleware");

// Réservé aux volontaires connectés (contrairement à l'upload de photo de
// témoignage NumSAL, totalement public) — fileFilter en garde-fou
// supplémentaire pour rejeter d'emblée tout fichier non-image.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// 🔐 Volontaire connecté ("Mon espace")
router.post("/submissions", volunteerAuthMiddleware, ctrl.submitTask);
router.get("/my-progress/:programId", volunteerAuthMiddleware, ctrl.getMyProgramProgress);
router.post("/upload-proof-image", volunteerAuthMiddleware, upload.single("file"), ctrl.uploadProofImage);

// 🔐 Staff — modération + suivi (autorisation fine via canReviewProgram dans le contrôleur)
router.get("/my-supervised-programs", authMiddleware, ctrl.listMySupervisedPrograms);
router.get("/submissions", authMiddleware, ctrl.listSubmissions);
router.patch("/submissions/:id/accept", authMiddleware, ctrl.approveSubmission);
router.patch("/submissions/:id/reject", authMiddleware, ctrl.rejectSubmission);
router.get("/programs/:programId/progress", authMiddleware, ctrl.listProgramProgress);

module.exports = router;
