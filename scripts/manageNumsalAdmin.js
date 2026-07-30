/**
 * Script : gestion d'un compte ADMIN NumSAL (mot de passe / suppression)
 *
 * Les comptes ADMIN sont volontairement exclus du panneau de gestion des
 * comptes de l'admin NumSAL (voir AdminNumsalDashboard.jsx / adminController)
 * — pour agir sur un compte ADMIN, on passe par ce script, exécuté
 * manuellement, directement contre la base réelle.
 *
 * Usage :
 *   node scripts/manageNumsalAdmin.js reset-password admin@numsal.ampbenin.org
 *   node scripts/manageNumsalAdmin.js reset-password admin@numsal.ampbenin.org --password=MonNouveauMdp123
 *   node scripts/manageNumsalAdmin.js delete admin@numsal.ampbenin.org --confirm
 */

require("dotenv").config();
const crypto = require("crypto");
const connectDB = require("../config/db");
const getNumsalUserModel = require("../models/numsal/NumsalUser");

const [, , action, email, ...rest] = process.argv;

const flag = (name) => rest.find((a) => a.startsWith(`--${name}`));
const flagValue = (name) => {
  const found = flag(name);
  if (!found) return null;
  const [, value] = found.split("=");
  return value || null;
};

function printUsageAndExit() {
  console.log("Usage :");
  console.log("  node scripts/manageNumsalAdmin.js reset-password <email> [--password=xxx]");
  console.log("  node scripts/manageNumsalAdmin.js delete <email> --confirm");
  process.exit(1);
}

async function resetPassword(NumsalUser, admin) {
  const tempPassword = flagValue("password") || crypto.randomBytes(6).toString("hex");
  admin.password = tempPassword;
  admin.mustChangePassword = true;
  await admin.save();

  console.log("✅ Mot de passe réinitialisé avec succès pour", admin.email);
  console.log("🔐 Nouveau mot de passe :", tempPassword);
  console.log("ℹ️  Le compte devra le changer à la prochaine connexion.");
}

async function deleteAdmin(NumsalUser, admin) {
  if (!flag("confirm")) {
    console.log("⚠️  Suppression non confirmée — relancez avec --confirm pour confirmer la suppression :");
    console.log(`    node scripts/manageNumsalAdmin.js delete ${admin.email} --confirm`);
    process.exit(1);
  }

  const otherAdminCount = await NumsalUser.countDocuments({ role: "ADMIN", _id: { $ne: admin._id } });
  if (otherAdminCount === 0) {
    console.log("❌ Impossible de supprimer ce compte : c'est le seul compte ADMIN NumSAL restant.");
    console.log("   Créez d'abord un autre compte ADMIN avant de supprimer celui-ci.");
    process.exit(1);
  }

  await admin.deleteOne();
  console.log("✅ Compte ADMIN supprimé avec succès :", admin.email);
}

async function main() {
  if (!["reset-password", "delete"].includes(action) || !email) {
    printUsageAndExit();
  }

  try {
    await connectDB();
    const NumsalUser = getNumsalUserModel();

    const admin = await NumsalUser.findOne({ email: email.toLowerCase().trim() });
    if (!admin) {
      console.log("❌ Aucun compte trouvé avec cet email :", email);
      process.exit(1);
    }
    if (admin.role !== "ADMIN") {
      console.log(`❌ Ce compte n'est pas un ADMIN (rôle actuel : ${admin.role}).`);
      console.log("   Utilisez le panneau de gestion des comptes NumSAL pour ce rôle.");
      process.exit(1);
    }

    if (action === "reset-password") {
      await resetPassword(NumsalUser, admin);
    } else {
      await deleteAdmin(NumsalUser, admin);
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SCRIPT :", err);
    process.exit(1);
  }
}

main();
