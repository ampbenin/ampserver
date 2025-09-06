const express = require("express");
const { loginAdmin, registerAdmin } = require("../controllers/adminController");

const router = express.Router();

// Authentification
router.post("/login", loginAdmin);

// Création d’un admin (⚠️ à sécuriser, sinon seulement en initialisation)
router.post("/register", registerAdmin);

module.exports = router;
