/**
 * Contrôleur d'authentification – GESTION AMP
 * - Login
 * - Changement de mot de passe (obligatoire ou volontaire)
 * - Mot de passe oublié / réinitialisation
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const getUserModel = require("../../models/gestionamp/User");
const jwtConfig = require("../../config/jwt");
const resend = require("../../utils/resendMailer");

/**
 * Génération du token JWT.
 * `mustChangePassword` est inclus dans le token : authMiddleware s'en sert
 * pour bloquer l'accès tant que le mot de passe temporaire n'a pas été changé.
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      coordinationCommunaleId: user.coordinationCommunaleId,
      institutionSpecialiseeId: user.institutionSpecialiseeId,
      mustChangePassword: user.mustChangePassword,
    },
    jwtConfig.secret,
    { expiresIn: jwtConfig.expiresIn }
  );
};

/**
 * @route POST /gestionamp/api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const User = getUserModel();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email et mot de passe requis" });
    }

    const user = await User.findOne({ email, isActive: true });
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
        coordinationCommunaleId: user.coordinationCommunaleId,
        institutionSpecialiseeId: user.institutionSpecialiseeId,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (error) {
    console.error("❌ Erreur login:", error.message);
    return res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /gestionamp/api/auth/change-password
 * Protégée par authMiddleware. Utilisée aussi bien pour le changement
 * obligatoire du mot de passe temporaire que pour un changement volontaire.
 */
exports.changePassword = async (req, res) => {
  try {
    const User = getUserModel();
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    // Le token précédent porte encore mustChangePassword=true : on en émet
    // un nouveau pour que le client puisse continuer sans se reconnecter.
    const token = generateToken(user);

    res.json({ message: "Mot de passe modifié avec succès", token });
  } catch (error) {
    console.error("❌ Erreur changePassword:", error.message);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /gestionamp/api/auth/forgot-password
 * Réponse volontairement identique que le compte existe ou non, pour ne
 * jamais révéler quels emails sont enregistrés.
 */
exports.forgotPassword = async (req, res) => {
  const genericResponse = {
    message: "Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.",
  };

  try {
    const User = getUserModel();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email requis" });
    }

    const user = await User.findOne({ email, isActive: true });
    if (!user) {
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();

    const frontendBase = process.env.FRONTEND_URL || "https://ampbenin.netlify.app";
    const resetUrl = `${frontendBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

    try {
      await resend.emails.send({
        // Fixé en dur : process.env.RESEND_FROM_EMAIL est partagée avec NumSAL
        // et réglée côté serveur sur son nom de marque, ce qui affichait
        // "NumSAL" comme expéditeur des emails de réinitialisation AMP Bénin.
        from: "AMP BENIN <onboarding@resend.dev>",
        to: email,
        subject: "Réinitialisation de votre mot de passe — AMP BENIN",
        text: `Bonjour ${user.name},\n\nVous avez demandé la réinitialisation de votre mot de passe.\nCliquez sur ce lien (valable 1 heure) pour choisir un nouveau mot de passe :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
        html: `<p>Bonjour ${user.name},</p><p>Vous avez demandé la réinitialisation de votre mot de passe.</p><p><a href="${resetUrl}">Cliquez ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
      });
    } catch (mailError) {
      console.error("❌ Erreur envoi email réinitialisation:", mailError.message);
      // On ne révèle pas l'échec d'envoi au client (ne pas divulguer d'info sur le compte).
    }

    res.json(genericResponse);
  } catch (error) {
    console.error("❌ Erreur forgotPassword:", error.message);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * @route POST /gestionamp/api/auth/reset-password
 */
exports.resetPassword = async (req, res) => {
  try {
    const User = getUserModel();
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
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
    console.error("❌ Erreur resetPassword:", error.message);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
