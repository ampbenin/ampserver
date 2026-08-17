const express = require("express");
const multer = require("multer");
const router = express.Router();

// ✅ chemins corrigés
const userController = require("../../controllers/gestionamp/userController");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// Même limite que les autres uploads d'image de ce backend.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// 🔐 Toutes les routes sont ADMIN uniquement
router.use(authMiddleware, roleMiddleware("ADMIN"));

// ➕ Créer un utilisateur EC ou IS
router.post("/", userController.createUser);

// 📋 Lister tous les utilisateurs
router.get("/", userController.getAllUsers);

// 🔄 Activer / désactiver un utilisateur
router.patch("/:id/status", userController.toggleUserStatus);

// ✏️ Modifier les informations d'un compte (nom/email/rôle/espace/mot de passe)
router.patch("/:id", userController.updateUser);

// 🗑️ Supprimer définitivement un compte
router.delete("/:id", userController.deleteUser);

// 🖼️ Définir/corriger le logo d'un compte PARTENAIRE (en plus du
// self-service déjà existant côté partenaire lui-même).
router.post("/:id/partner-logo", upload.single("file"), userController.uploadPartnerLogoForUser);

module.exports = router;
