// routes/volunteerRoute.js

const express = require("express");
const {
  createOrUpdateVolunteer,
  fetchVolunteersForCertificate,
  listVolunteers,
  getVolunteerById,
  deleteVolunteer,
  assignVolunteerMissions,
} = require("../controllers/volunteerController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const router = express.Router();

// 🔐 Outil interne de gestion des volontaires/missions (pas le formulaire public)
router.use(authMiddleware, roleMiddleware("ADMIN", "EDITOR"));

// ➕ Créer ou mettre à jour un volontaire
router.post("/", createOrUpdateVolunteer);

// 📥 Récupérer les volontaires pour certificat
router.post("/certificates", fetchVolunteersForCertificate);

// 🔎 Lister les volontaires avec recherche et filtrage
router.get("/", listVolunteers);

// 📄 Détail d’un volontaire
router.get("/:id", getVolunteerById);

// ✏️ Supprimer un volontaire
router.delete("/:id", deleteVolunteer);

// 🎯 Attribuer des missions supplémentaires
router.post("/:id/assign-missions", assignVolunteerMissions);

module.exports = router;
