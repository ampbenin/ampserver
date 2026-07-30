/**
 * Script : Création du premier ADMIN GESTION AMP
 * Utilise EXACTEMENT la même config que le serveur
 */

const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const cors = require("cors");


async function createAdmin() {
  try {
    // 🔌 Connexion DB (MAIN + FORM)
    dotenv.config();
    connectDB();
    
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
      password: "admin123", // sera hashé automatiquement
      role: "ADMIN",
      mustChangePassword: true,
      isActive: true,
    });

    console.log("✅ ADMIN AMP créé avec succès");
    console.log("📧 Email :", admin.email);
    console.log("🔐 Mot de passe temporaire : admin123");

    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SCRIPT :", err.message);
    process.exit(1);
  }
}

createAdmin();
