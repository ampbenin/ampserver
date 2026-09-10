const express = require("express");
const multer = require("multer");
const router = express.Router();
const {
  fetchVolunteersForCertificate,
  uploadCertificateTemplate,
  generateCertificate,
  verifyAttestation,
} = require("../controllers/certificateController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");

// Mêmes limites que le champ image existant le plus proche (partners-bar,
// voir volunteerProgramRoute.js) — un peu plus large (10 Mo) pour couvrir un
// PNG/JPG haute résolution.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// 🔐 Staff (ADMIN, ou EDITOR affecté à CE programme — voir canReviewProgram
// dans le contrôleur, même porte que le reste du chantier volontaires).
// Scopées par programme (2026-08-19) — remplace l'ancien schéma par titre.
router.get("/programs/:programId/eligible-volunteers", authMiddleware, fetchVolunteersForCertificate);
router.put("/programs/:programId/template", authMiddleware, upload.single("file"), uploadCertificateTemplate);
router.post("/programs/:programId/generate", authMiddleware, generateCertificate);

// 🌐 QR Code public → vérification d'une attestation (auto-service de
// téléchargement par email/nom supprimé le 2026-08-19 — chaque volontaire
// télécharge désormais depuis son espace authentifié, "Mon espace").
router.get("/verify/:id", verifyAttestation);

module.exports = router;
