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

// 🔧 Diagnostic temporaire (2026-09-10) — à retirer une fois le souci de
// déploiement Railway confirmé/résolu. Public, pas d'info sensible :
// permet de vérifier en un clic (simple visite d'URL, sans console) que le
// déploiement en ligne correspond bien à ce commit.
router.get("/_diag", (req, res) => {
  res.json({ ok: true, marker: "certif-template-v1", deployedAt: "2026-09-10T13:40Z" });
});

module.exports = router;
