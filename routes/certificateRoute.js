const express = require("express");
const router = express.Router();
const {
  fetchVolunteersForCertificate,
  generateCertificate,
  downloadCertificate,
  verifyAttestation,
} = require("../controllers/certificateController");

// Récupérer les volontaires éligibles
router.post("/fetch-volunteers", fetchVolunteersForCertificate);

// Générer les attestations
router.post("/generate", generateCertificate);

// Télécharger une attestation ou lister les missions disponibles
router.post("/download", downloadCertificate);

// QR Code → envoie l'ID de l'attestation
router.get("/verify/:id", verifyAttestation);

module.exports = router;
