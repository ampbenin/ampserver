// routes/volunteerRoute.js

const express = require("express");
const {
  createOrUpdateVolunteer,
  fetchVolunteersForCertificate,
  searchVolunteerByEmail,
  listVolunteers,
  getVolunteerById,
  deleteVolunteer,
  assignVolunteerMissions,
} = require("../controllers/volunteerController");

const router = express.Router();

// ➕ Créer ou mettre à jour un volontaire
router.post("/", createOrUpdateVolunteer);

// 📥 Récupérer les volontaires pour certificat
router.post("/certificates", fetchVolunteersForCertificate);

router.post("/",   searchVolunteerByEmail);

// 🔎 Lister les volontaires avec recherche et filtrage
router.get("/", listVolunteers);

// 📄 Détail d’un volontaire
router.get("/:id", getVolunteerById);

// ✏️ Supprimer un volontaire
router.delete("/:id", deleteVolunteer);

// 🎯 Attribuer des missions supplémentaires
router.post("/:id/assign-missions", assignVolunteerMissions);

module.exports = router;
