/**
 * Script : gestion des comptes ADMIN/EDITOR de l'admin AMP Bénin
 * (créer, lister, réinitialiser un mot de passe, supprimer) — pour ne plus
 * dépendre d'un script à usage unique avec des identifiants figés
 * (voir l'ancien scripts/createAmpAdmin.js, laissé tel quel).
 *
 * Volontairement limité aux rôles ADMIN/EDITOR : les comptes EC/IS ont
 * besoin d'être rattachés à une Coordination Communale / Institution
 * Spécialisée existante et se créent depuis le tableau de bord ADMIN
 * (AddUserForm.jsx), pas en ligne de commande.
 *
 * Usage :
 *   node scripts/manageAmpAdmin.js create <email> --name="Nom Complet" [--role=ADMIN|EDITOR] [--password=xxx]
 *   node scripts/manageAmpAdmin.js list
 *   node scripts/manageAmpAdmin.js reset-password <email> [--password=xxx]
 *   node scripts/manageAmpAdmin.js delete <email> --confirm
 *
 * Si --password est omis (create / reset-password), un mot de passe
 * temporaire aléatoire est généré et affiché — le compte devra le changer
 * à la prochaine connexion (page /change-password).
 */

require("dotenv").config();
const crypto = require("crypto");
const connectDB = require("../config/db");
const getUserModel = require("../models/gestionamp/User");

const [, , action, emailArg, ...rest] = process.argv;

const flag = (name) => rest.find((a) => a.startsWith(`--${name}`));
const flagValue = (name) => {
  const found = flag(name);
  if (!found) return null;
  const eq = found.indexOf("=");
  return eq === -1 ? null : found.slice(eq + 1);
};

function printUsageAndExit() {
  console.log("Usage :");
  console.log('  node scripts/manageAmpAdmin.js create <email> --name="Nom Complet" [--role=ADMIN|EDITOR] [--password=xxx]');
  console.log("  node scripts/manageAmpAdmin.js list");
  console.log("  node scripts/manageAmpAdmin.js reset-password <email> [--password=xxx]");
  console.log("  node scripts/manageAmpAdmin.js delete <email> --confirm");
  process.exit(1);
}

function randomPassword() {
  return crypto.randomBytes(6).toString("hex");
}

async function createAccount(User) {
  if (!emailArg) printUsageAndExit();
  const email = emailArg.toLowerCase().trim();
  const name = flagValue("name");
  const role = (flagValue("role") || "ADMIN").toUpperCase();

  if (!name) {
    console.log('❌ --name="Nom Complet" est requis pour créer un compte.');
    process.exit(1);
  }
  if (!["ADMIN", "EDITOR"].includes(role)) {
    console.log(`❌ Rôle invalide : ${role}. Ce script ne gère que ADMIN et EDITOR.`);
    console.log("   Pour un compte EC/IS, utilisez le tableau de bord ADMIN (gestion des utilisateurs).");
    process.exit(1);
  }

  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`❌ Un compte existe déjà avec cet email (rôle ${existing.role}).`);
    console.log(`   Utilisez plutôt : node scripts/manageAmpAdmin.js reset-password ${email}`);
    process.exit(1);
  }

  const password = flagValue("password") || randomPassword();

  const user = await User.create({
    name,
    email,
    password,
    role,
    mustChangePassword: true,
    isActive: true,
  });

  console.log(`✅ Compte ${role} créé avec succès`);
  console.log("👤 Nom :", user.name);
  console.log("📧 Email :", user.email);
  console.log("🔐 Mot de passe temporaire :", password);
  console.log("ℹ️  Le compte devra le changer à la première connexion (/admin/login).");
}

async function listAccounts(User) {
  const users = await User.find({ role: { $in: ["ADMIN", "EDITOR"] } })
    .select("name email role isActive mustChangePassword createdAt")
    .sort({ createdAt: 1 });

  if (users.length === 0) {
    console.log("Aucun compte ADMIN/EDITOR trouvé.");
    return;
  }

  console.log(`${users.length} compte(s) :\n`);
  users.forEach((u) => {
    console.log(
      `- ${u.email}  [${u.role}]  ${u.isActive ? "actif" : "désactivé"}` +
        `${u.mustChangePassword ? "  (doit changer son mot de passe)" : ""}` +
        `  — ${u.name}, créé le ${u.createdAt.toLocaleDateString("fr-FR")}`
    );
  });
}

async function resetPassword(User, user) {
  const password = flagValue("password") || randomPassword();
  user.password = password;
  user.mustChangePassword = true;
  await user.save();

  console.log("✅ Mot de passe réinitialisé avec succès pour", user.email);
  console.log("🔐 Nouveau mot de passe temporaire :", password);
  console.log("ℹ️  Le compte devra le changer à la prochaine connexion.");
}

async function deleteAccount(User, user) {
  if (!flag("confirm")) {
    console.log("⚠️  Suppression non confirmée — relancez avec --confirm pour confirmer :");
    console.log(`    node scripts/manageAmpAdmin.js delete ${user.email} --confirm`);
    process.exit(1);
  }

  if (user.role === "ADMIN") {
    const otherAdminCount = await User.countDocuments({ role: "ADMIN", _id: { $ne: user._id } });
    if (otherAdminCount === 0) {
      console.log("❌ Impossible de supprimer ce compte : c'est le seul compte ADMIN restant.");
      console.log("   Créez d'abord un autre compte ADMIN avant de supprimer celui-ci.");
      process.exit(1);
    }
  }

  await user.deleteOne();
  console.log("✅ Compte supprimé avec succès :", user.email);
}

async function main() {
  if (!["create", "list", "reset-password", "delete"].includes(action)) {
    printUsageAndExit();
  }

  try {
    await connectDB();
    const User = getUserModel();

    if (action === "create") {
      await createAccount(User);
      process.exit(0);
    }

    if (action === "list") {
      await listAccounts(User);
      process.exit(0);
    }

    // reset-password / delete : ciblent un compte existant par email
    if (!emailArg) printUsageAndExit();
    const email = emailArg.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ Aucun compte trouvé avec cet email :", email);
      process.exit(1);
    }
    if (!["ADMIN", "EDITOR"].includes(user.role)) {
      console.log(`❌ Ce compte n'est pas ADMIN/EDITOR (rôle actuel : ${user.role}).`);
      console.log("   Utilisez le tableau de bord ADMIN (gestion des utilisateurs) pour ce rôle.");
      process.exit(1);
    }

    if (action === "reset-password") {
      await resetPassword(User, user);
    } else {
      await deleteAccount(User, user);
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SCRIPT :", err);
    process.exit(1);
  }
}

main();
