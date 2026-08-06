/**
 * Contrôleur d'authentification — Comptes volontaires ("Mon espace")
 * Le compte EST le profil Volunteer (models/volunteer.js), pas une
 * collection séparée façon NumsalUser : "s'inscrire" = trouver-ou-créer la
 * fiche par email, puis envoyer un lien pour définir un mot de passe —
 * jamais de mot de passe en clair envoyé par email (voir le plan de ce
 * chantier). Réponses génériques en cas d'email déjà utilisé, même
 * principe anti-énumération que controllers/gestionamp/authController.js.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Volunteer = require("../models/volunteer");
const VolunteerSanction = require("../models/volunteerSanction");
const jwtConfig = require("../config/jwt");
const resend = require("../utils/resendMailer");
const { renderBrandedEmail, escapeHtml } = require("../utils/emailTemplates");
const { attachProgramTitles } = require("./volunteerController");

// Adresse alignée sur le domaine vérifié Resend (candidatures@ampbenin.org,
// voir .env RESEND_FROM_EMAIL) — PAS onboarding@resend.dev (domaine
// sandbox Resend, restreint à l'email du propriétaire du compte : les
// emails vers de vrais destinataires n'arrivaient plus avec cette adresse).
const RESEND_FROM = "VOLONTAIRE AMP BENIN <candidatures@ampbenin.org>";
const FRONTEND_BASE = process.env.FRONTEND_URL || "https://ampbenin.netlify.app";
const AMP_BRAND = {
  brandLabel: "AMP BÉNIN — Volontariat",
  footerText: "AMP BÉNIN — Programme de volontariat · Ceci est un message automatique.",
};
const GENERIC_REGISTER_RESPONSE = {
  message: "Si cet email n'est pas déjà associé à un compte actif, vous allez recevoir un lien pour définir votre mot de passe.",
};

const generateToken = (volunteer) =>
  jwt.sign({ id: volunteer._id, email: volunteer.email }, jwtConfig.volunteer.secret, {
    expiresIn: jwtConfig.volunteer.expiresIn,
  });

/* -------------------- Interne : générer un lien de définition de mot de passe -------------------- */
/* Sert à la fois pour l'activation initiale (nouveau compte / profil
   réclamé) et pour "mot de passe oublié" — même mécanisme. Ne fait
   qu'écrire le token et retourner l'URL, sans envoyer d'email : réutilisée
   directement par volunteerApplicationController.finalizeAcceptance pour
   intégrer le lien DANS l'email d'acceptation existant (pas un email
   séparé), et par sendSetPasswordLink ci-dessous pour ses propres emails
   dédiés (inscription libre, mot de passe oublié). */
async function generateSetPasswordUrl(volunteer) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  volunteer.passwordResetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  volunteer.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await volunteer.save();
  return `${FRONTEND_BASE}/mon-espace/definir-mot-de-passe?token=${rawToken}&email=${encodeURIComponent(volunteer.email)}`;
}

/* -------------------- Interne : envoyer un email dédié avec ce lien -------------------- */
async function sendSetPasswordLink(volunteer, { isNewAccount }) {
  const setUrl = await generateSetPasswordUrl(volunteer);
  const title = isNewAccount ? "Activez votre espace volontaire" : "Définir un nouveau mot de passe";
  const intro = isNewAccount
    ? "Votre espace volontaire AMP BÉNIN est prêt. Cliquez ci-dessous pour choisir votre mot de passe et y accéder :"
    : "Cliquez ci-dessous pour choisir un nouveau mot de passe :";

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: volunteer.email,
      subject: `${title} — AMP BÉNIN`,
      text: `Bonjour ${volunteer.prenom},\n\n${intro}\n${setUrl}\n\n(Lien valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.)`,
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title,
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(volunteer.prenom)},</p>`,
          `<p>${intro}</p>`,
          `<p style="text-align:center;margin:28px 0;"><a href="${setUrl}" style="display:inline-block;background:#1B4332;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">Définir mon mot de passe</a></p>`,
          `<p style="font-size:13px;color:#7A7A7A;">Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email lien mot de passe volontaire:", mailError.message);
  }
}

/* -------------------- Public : inscription libre -------------------- */
exports.register = async (req, res, next) => {
  try {
    const { prenom, nom, email, telephone } = req.body;
    if (!prenom || !nom || !email) {
      return res.status(400).json({ message: "Prénom, nom et email requis" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let volunteer = await Volunteer.findOne({ email: normalizedEmail });

    if (!volunteer) {
      volunteer = await Volunteer.create({ prenom, nom, email: normalizedEmail, telephone: telephone || "" });
      await sendSetPasswordLink(volunteer, { isNewAccount: true });
    } else if (!volunteer.password) {
      // Profil déjà connu (créé par le staff ou via une candidature) mais
      // jamais activé — on lui envoie le lien pour réclamer son compte,
      // sans créer de doublon.
      await sendSetPasswordLink(volunteer, { isNewAccount: true });
    }
    // Si un mot de passe existe déjà : rien de nouveau n'est envoyé (réponse
    // générique quand même, anti-énumération — même principe que forgotPassword).

    res.json(GENERIC_REGISTER_RESPONSE);
  } catch (error) {
    if (error.code === 11000) {
      // Course rare (deux inscriptions simultanées pour le même email).
      return res.json(GENERIC_REGISTER_RESPONSE);
    }
    next(error);
  }
};

/* -------------------- Public : connexion -------------------- */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email et mot de passe requis" });
    }

    // Cherché par email SEUL (pas isActive:true dans la requête) : une
    // suspension arrivée à échéance doit se lever automatiquement ici,
    // avant de décider si le compte est bloqué ou non (voir plus bas) —
    // impossible à faire avec un simple filtre Mongo statique.
    const volunteer = await Volunteer.findOne({ email: email.toLowerCase().trim() });
    if (!volunteer) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    if (!volunteer.isActive) {
      const activeSuspension = await VolunteerSanction.findOne({
        volunteerId: volunteer._id, type: "SUSPENSION", status: "ACTIVE",
      });

      if (activeSuspension?.suspendedUntil && activeSuspension.suspendedUntil <= new Date()) {
        // Période de suspension écoulée : réactivation automatique, pas
        // besoin d'une action ADMIN (décision confirmée avec l'utilisateur).
        activeSuspension.status = "LIFTED";
        activeSuspension.liftedAt = new Date();
        activeSuspension.liftReason = "Fin de la période de suspension (automatique)";
        await activeSuspension.save();
        volunteer.isActive = true;
        await volunteer.save();
      } else {
        const untilStr = activeSuspension?.suspendedUntil
          ? ` jusqu'au ${new Date(activeSuspension.suspendedUntil).toLocaleDateString("fr-FR")}`
          : "";
        return res.status(403).json({ message: `Votre compte est suspendu${untilStr}.` });
      }
    }

    if (!volunteer.password) {
      return res.status(403).json({
        message: 'Ce compte n\'est pas encore activé — consultez votre email, ou utilisez "mot de passe oublié" pour recevoir un nouveau lien.',
      });
    }

    const isMatch = await volunteer.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const token = generateToken(volunteer);
    res.json({
      token,
      volunteer: { id: volunteer._id, prenom: volunteer.prenom, nom: volunteer.nom, email: volunteer.email },
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : demande de lien (mot de passe oublié / jamais activé) -------------------- */
exports.requestPasswordLink = async (req, res, next) => {
  const genericResponse = { message: "Si un compte existe avec cet email, un lien vient de vous être envoyé." };
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email requis" });

    const volunteer = await Volunteer.findOne({ email: email.toLowerCase().trim(), isActive: true });
    if (!volunteer) return res.json(genericResponse);

    await sendSetPasswordLink(volunteer, { isNewAccount: !volunteer.password });
    res.json(genericResponse);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : définir le mot de passe (via le lien reçu par email) -------------------- */
exports.setPassword = async (req, res, next) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const volunteer = await Volunteer.findOne({
      email: email.toLowerCase().trim(),
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });
    if (!volunteer) {
      return res.status(400).json({ message: "Lien invalide ou expiré" });
    }

    volunteer.password = newPassword;
    volunteer.passwordResetTokenHash = null;
    volunteer.passwordResetExpires = null;
    await volunteer.save();

    res.json({ message: "Mot de passe défini avec succès. Vous pouvez vous connecter." });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé : profil du volontaire connecté -------------------- */
exports.me = async (req, res, next) => {
  try {
    const volunteer = await Volunteer.findById(req.user.id)
      .select("-password -passwordResetTokenHash -passwordResetExpires");
    if (!volunteer) return res.status(404).json({ message: "Profil introuvable" });

    const [populated] = await attachProgramTitles([volunteer]);

    // Avertissements actifs non encore lus — voir
    // volunteerDisciplineController.js. Affichés en bandeau "Mon espace"
    // (src/components/volunteer/Dashboard.jsx), disparaissent une fois
    // accusés (POST /api/volunteer-auth/warnings/:id/acknowledge).
    const activeWarnings = await VolunteerSanction.find({
      volunteerId: req.user.id, type: "WARNING", status: "ACTIVE", acknowledgedAt: null,
    }).select("reason appliedAt");
    populated.activeWarnings = activeWarnings;

    res.json(populated);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (Mon espace) : marquer un avertissement comme lu -------------------- */
exports.acknowledgeWarning = async (req, res, next) => {
  try {
    const sanction = await VolunteerSanction.findOne({
      _id: req.params.id, volunteerId: req.user.id, type: "WARNING",
    });
    if (!sanction) return res.status(404).json({ message: "Avertissement introuvable" });

    sanction.acknowledgedAt = new Date();
    await sanction.save();

    res.json({ message: "Avertissement marqué comme lu" });
  } catch (error) {
    next(error);
  }
};

exports.sendSetPasswordLink = sendSetPasswordLink;
exports.generateSetPasswordUrl = generateSetPasswordUrl;
