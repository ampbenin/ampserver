/**
 * Contrôleur d'authentification – Plateforme NumSAL
 * - Inscription (apprenants uniquement, en libre-service)
 * - Connexion
 * - Changement de mot de passe (obligatoire ou volontaire)
 * - Mot de passe oublié / réinitialisation
 *
 * Reprend le flux déjà durci de controllers/gestionamp/authController.js
 * (token de réinitialisation haché en SHA-256, jamais stocké en clair,
 * réponse générique anti-énumération sur "mot de passe oublié").
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Sentry = require("@sentry/node");
const getNumsalUserModel = require("../../models/numsal/NumsalUser");
const jwtConfig = require("../../config/jwt");
const transporter = require("../../utils/mailer");

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
    jwtConfig.numsal.secret,
    { expiresIn: jwtConfig.numsal.expiresIn }
  );
};

/**
 * @route POST /numsal/api/auth/register
 * @desc  Inscription en libre-service — toujours créée avec le rôle
 *        APPRENANT, jamais accepté depuis le corps de la requête.
 */
exports.register = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Nom, email et mot de passe requis" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
    }

    const existing = await NumsalUser.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Un compte existe déjà avec cet email" });
    }

    const user = await NumsalUser.create({
      name,
      email,
      password,
      role: "APPRENANT",
      mustChangePassword: false,
    });

    const token = generateToken(user);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (error) {
    console.error("❌ Erreur register NumSAL:", error.message);
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /numsal/api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email et mot de passe requis" });
    }

    const user = await NumsalUser.findOne({ email, isActive: true });
    if (!user) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const token = generateToken(user);

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (error) {
    console.error("❌ Erreur login NumSAL:", error.message);
    Sentry.captureException(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /numsal/api/auth/change-password
 */
exports.changePassword = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
    }

    const user = await NumsalUser.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    const token = generateToken(user);

    res.json({ message: "Mot de passe modifié avec succès", token });
  } catch (error) {
    console.error("❌ Erreur changePassword NumSAL:", error.message);
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /numsal/api/auth/forgot-password
 */
exports.forgotPassword = async (req, res) => {
  const genericResponse = {
    message: "Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.",
  };

  try {
    const NumsalUser = getNumsalUserModel();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email requis" });
    }

    const user = await NumsalUser.findOne({ email, isActive: true });
    if (!user) {
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();

    const frontendBase = process.env.NUMSAL_FRONTEND_URL || "https://numsal.ampbenin.org";
    const resetUrl = `${frontendBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: email,
        subject: "Réinitialisation de votre mot de passe — NumSAL",
        text: `Bonjour ${user.name},\n\nVous avez demandé la réinitialisation de votre mot de passe NumSAL.\nCliquez sur ce lien (valable 1 heure) pour choisir un nouveau mot de passe :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
        html: `<p>Bonjour ${user.name},</p><p>Vous avez demandé la réinitialisation de votre mot de passe NumSAL.</p><p><a href="${resetUrl}">Cliquez ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
      });
    } catch (mailError) {
      console.error("❌ Erreur envoi email réinitialisation NumSAL:", mailError.message);
      Sentry.captureException(mailError);
    }

    res.json(genericResponse);
  } catch (error) {
    console.error("❌ Erreur forgotPassword NumSAL:", error.message);
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /numsal/api/auth/reset-password
 */
exports.resetPassword = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await NumsalUser.findOne({
      email,
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Lien de réinitialisation invalide ou expiré" });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    user.passwordResetTokenHash = null;
    user.passwordResetExpires = null;
    await user.save();

    res.json({ message: "Mot de passe réinitialisé avec succès. Vous pouvez vous connecter." });
  } catch (error) {
    console.error("❌ Erreur resetPassword NumSAL:", error.message);
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
