const express = require("express");
const router = express.Router();
const {
  fetchVolunteersForCertificate,
  generateCertificate,
  downloadCertificate,
  verifyAttestation,
} = require("../controllers/certificateController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const requireEditor = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

// 🔐 Outils internes de génération (espace admin uniquement)
router.post("/fetch-volunteers", ...requireEditor, fetchVolunteersForCertificate);
router.post("/generate", ...requireEditor, generateCertificate);

// 🌐 Auto-service public : le volontaire télécharge sa propre attestation
router.post("/download", downloadCertificate);

// 🌐 QR Code public → vérification d'une attestation
router.get("/verify/:id", verifyAttestation);

module.exports = router;
