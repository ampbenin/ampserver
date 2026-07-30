/**
 * Script : Création d'un compte ADMIN NumSAL (le premier, ou un
 * supplémentaire — plusieurs admins peuvent coexister). À exécuter
 * manuellement, contre la base réelle :
 *
 *   node scripts/createNumsalAdmin.js
 *   node scripts/createNumsalAdmin.js "Nom complet" email@ampbenin.org
 *   node scripts/createNumsalAdmin.js "Bertrand ATCHOGNON Mbre HCS" bertrand.atc@ampbenin.org Admin123
 *
 * Sans argument, crée l'admin par défaut historique (utile pour un tout
 * premier démarrage). Le seul garde-fou est l'unicité de l'EMAIL (le
 * schéma NumsalUser l'exige de toute façon) — pas de limite au nombre
 * d'ADMIN.
 */

require("dotenv").config();
const crypto = require("crypto");
const connectDB = require("../config/db");
const getNumsalUserModel = require("../models/numsal/NumsalUser");

const [, , nameArg, emailArg, passwordArg] = process.argv;

const name = nameArg || "Administrateur NumSAL";
const email = (emailArg || "admin@numsal.ampbenin.org").toLowerCase().trim();
const password = passwordArg || crypto.randomBytes(6).toString("hex");

async function createAdmin() {
  try {
    await connectDB();

    const NumsalUser = getNumsalUserModel();

    const existing = await NumsalUser.findOne({ email });
    if (existing) {
      console.log(`⚠️ Un compte existe déjà avec cet email (${email}) — rôle actuel : ${existing.role}`);
      process.exit(1);
    }

    const admin = await NumsalUser.create({
      name,
      email,
      password, // hash automatique, à changer dès la première connexion
      role: "ADMIN",
      mustChangePassword: true,
      isActive: true,
    });

    const totalAdmins = await NumsalUser.countDocuments({ role: "ADMIN" });

    console.log("✅ ADMIN NumSAL créé avec succès");
    console.log("📧 Email :", admin.email);
    console.log("🔐 Mot de passe temporaire :", password);
    console.log(`ℹ️  Total de comptes ADMIN NumSAL maintenant : ${totalAdmins}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SCRIPT :", err);
    process.exit(1);
  }
}

createAdmin();
