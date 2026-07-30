/**
 * Script : Création du premier ADMIN GESTION AMP
 * Utilise EXACTEMENT la même config que le serveur
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getUserModel = require("../models/gestionamp/User");

async function createAdmin() {
  try {
    // 🔌 Connexion DB (MAIN + FORM) — OBLIGATOIRE
    await connectDB();

    // 📦 Récupération du modèle User (DB2)
    const User = getUserModel();

    // 🔍 Vérifier s'il existe déjà
    const existing = await User.findOne({ role: "ADMIN" });
    if (existing) {
      console.log("⚠️ Un ADMIN AMP existe déjà :", existing.email);
      process.exit(0);
    }

    // 👤 Création ADMIN
    const admin = await User.create({
      name: "Administrateur AMP",
      email: "admin@amp.bj",
      password: "admin123", // hash auto
      role: "ADMIN",
      mustChangePassword: true,
      isActive: true,
    });

    console.log("✅ ADMIN AMP créé avec succès");
    console.log("📧 Email :", admin.email);
    console.log("🔐 Mot de passe temporaire : admin123");

    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SCRIPT :", err);
    process.exit(1);
  }
}

createAdmin();
