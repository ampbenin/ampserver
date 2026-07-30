const express = require("express");
const router = express.Router();

// ✅ chemins corrigés
const userController = require("../../controllers/gestionamp/userController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// 🔐 Toutes les routes sont ADMIN uniquement
router.use(authMiddleware, roleMiddleware("ADMIN"));

// ➕ Créer un utilisateur EC ou IS
router.post("/", userController.createUser);

// 📋 Lister tous les utilisateurs
router.get("/", userController.getAllUsers);

// 🔄 Activer / désactiver un utilisateur
router.patch("/:id/status", userController.toggleUserStatus);

module.exports = router;
