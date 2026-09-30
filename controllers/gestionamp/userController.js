/**
 * Contrôleur de gestion des utilisateurs
 * Accès strictement réservé aux ADMIN
 */

const streamifier = require("streamifier");
const crypto = require("crypto");
const getUserModel = require("../../models/gestionamp/User");
const getCoordinationCommunaleModel = require("../../models/gestionamp/CoordinationCommunale");
const getInstitutionSpecialiseeModel = require("../../models/gestionamp/InstitutionSpecialisee");
const cloudinary = require("../../utils/cloudinary");
const resend = require("../../utils/resendMailer");

/**
 * @route GET /gestionamp/api/users/staff-directory
 * @desc Annuaire allégé du personnel — ADMIN et EDITOR (pas seulement
 * ADMIN, contrairement à getAllUsers ci-dessous). Sert uniquement à
 * peupler les sélecteurs d'affectation (superviseurs/partenaires/éditeurs)
 * dans VolunteerProgramEditor.jsx, jamais à gérer les comptes eux-mêmes
 * (création/modification/suppression restent ADMIN uniquement, voir
 * routes/gestionamp/userRoutes.js). Champs volontairement réduits : ni mot
 * de passe, ni jeton de réinitialisation, ni rattachement CC/IS.
 */
exports.listStaffDirectory = async (req, res) => {
  try {
    const User = getUserModel();
    const users = await User.find().select(
      "name email role supervisedAssignments partnerProgramIds partnerLogoUrl"
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route POST /gestionamp/api/users
 * @desc Créer un utilisateur EC, IS ou EDITOR
 */
exports.createUser = async (req, res) => {
  try {
    const User = getUserModel();
    const {
      name,
      email,
      password,
      role,
      coordinationCommunaleId,
      institutionSpecialiseeId,
    } = req.body;

    // Vérification du rôle autorisé — ADMIN inclus depuis 2026-09-30 (retour
    // utilisateur : "on ne donne pas le droit ADMIN aux gens alors qu'on
    // doit donner ADMIN aussi"). updateUser (édition) l'acceptait déjà pour
    // un compte existant ; seule la création via ce formulaire l'excluait.
    if (!["ADMIN", "EC", "IS", "EDITOR", "SUPERVISEUR", "PARTENAIRE"].includes(role)) {
      return res.status(400).json({
        message: "Rôle invalide",
      });
    }

    // Vérification des contraintes d’espace
    if (role === "EC" && !coordinationCommunaleId) {
      return res.status(400).json({
        message: "coordinationCommunaleId requis pour un EC",
      });
    }

    if (role === "IS" && !institutionSpecialiseeId) {
      return res.status(400).json({
        message: "institutionSpecialiseeId requis pour un IS",
      });
    }

    // Si l'email a déjà un compte : on ne crée pas de doublon, on renomme
    // simplement ce compte existant avec le nouveau rôle (cas d'usage
    // demandé : "on le nomme SUPERVISEUR/PARTENAIRE, pas besoin d'un autre
    // compte"). Garde-fou : jamais de rétrogradation silencieuse d'un
    // compte ADMIN via ce formulaire — geste trop sensible pour être
    // implicite, à faire à la main si vraiment voulu.
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.role === "ADMIN") {
        return res.status(409).json({
          message: "Ce compte est déjà ADMIN — changez son rôle manuellement si c'est vraiment voulu.",
        });
      }

      existingUser.role = role;
      if (name) existingUser.name = name;
      existingUser.coordinationCommunaleId = role === "EC" ? coordinationCommunaleId : null;
      existingUser.institutionSpecialiseeId = role === "IS" ? institutionSpecialiseeId : null;
      await existingUser.save();

      return res.status(200).json({
        message: `Compte existant renommé ${role} avec succès (aucun nouveau compte créé).`,
        user: { id: existingUser._id, name: existingUser.name, email: existingUser.email, role: existingUser.role },
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      coordinationCommunaleId: role === "EC" ? coordinationCommunaleId : null,
      institutionSpecialiseeId:
        role === "IS" ? institutionSpecialiseeId : null,
      mustChangePassword: true,
    });

    res.status(201).json({
      message: "Utilisateur créé avec succès",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route POST /gestionamp/api/users/:id/send-invite
 * @desc Envoie un email d'invitation au compte visé, avec un bouton qui lui
 * permet de définir son mot de passe et de se connecter — retour
 * utilisateur, 2026-09-30 : "lors de la création il faut un bouton envoyer
 * de mail... le mail va contenir un bouton qui va lui permettre de se
 * connecter". Réutilise exactement le même mécanisme que
 * authController.js#forgotPassword (passwordResetTokenHash/Expires +
 * page /reset-password déjà existante côté frontend) — pas de nouvelle
 * page à construire, juste une expiration plus longue (7 jours, adaptée à
 * une invitation plutôt qu'à un mot de passe oublié urgent) et un texte
 * d'email différent. Utilisable aussi bien juste après la création
 * (bouton dans AddUserForm.jsx) qu'a posteriori pour un compte existant
 * (bouton dans UsersTable.jsx, ex : renvoyer l'invitation).
 */
exports.sendInviteEmail = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.passwordResetExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
    await user.save();

    const frontendBase = process.env.FRONTEND_URL || "https://ampbenin.org";
    const setPasswordUrl = `${frontendBase}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    try {
      await resend.emails.send({
        from: "AMP BENIN <candidatures@ampbenin.org>",
        to: user.email,
        subject: "Votre compte AMP BENIN a été créé",
        text: `Bonjour ${user.name},\n\nUn compte vous a été créé sur la plateforme de gestion AMP BENIN.\nCliquez sur ce lien (valable 7 jours) pour définir votre mot de passe et vous connecter :\n${setPasswordUrl}\n\nSi vous ne vous attendiez pas à cet email, ignorez-le.`,
        html: `<p>Bonjour ${user.name},</p><p>Un compte vous a été créé sur la plateforme de gestion AMP BENIN.</p><p style="text-align:center;margin:28px 0;"><a href="${setPasswordUrl}" style="display:inline-block;background:#1B4332;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">Définir mon mot de passe et me connecter</a></p><p>Ce lien est valable 7 jours. Si vous ne vous attendiez pas à cet email, ignorez-le.</p>`,
      });
    } catch (mailError) {
      console.error("❌ Erreur envoi email d'invitation:", mailError.message);
      return res.status(502).json({ message: "Compte trouvé mais l'email n'a pas pu être envoyé — réessayez." });
    }

    res.json({ message: `Email d'invitation envoyé à ${user.email}` });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route GET /gestionamp/api/users
 * @desc Lister tous les utilisateurs (ADMIN)
 */
exports.getAllUsers = async (req, res) => {
  try {
    const User = getUserModel();
    // Voir authController.js#me : .populate() plante en 500 si ces modèles
    // "lazy" n'ont jamais été enregistrés — garanti ici plutôt que de
    // dépendre par coïncidence d'un autre appel fait avant (coordinations/
    // institutions) côté frontend.
    getCoordinationCommunaleModel();
    getInstitutionSpecialiseeModel();
    const users = await User.find()
      .populate("coordinationCommunaleId", "name commune")
      .populate("institutionSpecialiseeId", "name domaine")
      .select("-password");

    res.json(users);
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route PATCH /gestionamp/api/users/:id/status
 * @desc Activer / désactiver un compte utilisateur
 */
exports.toggleUserStatus = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        message: "Utilisateur introuvable",
      });
    }

    // Sécurité : empêcher la désactivation de soi-même
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        message: "Impossible de modifier son propre statut",
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      message: `Compte ${
        user.isActive ? "activé" : "désactivé"
      } avec succès`,
    });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route PATCH /gestionamp/api/users/:id
 * @desc Modifier les informations d'un compte (nom, email, rôle, espace
 *       associé, mot de passe optionnel). Bouton "Modifier" de
 *       UsersTable.jsx — n'existait pas jusqu'ici (bug signalé : "pas de
 *       possibilité de modifier les informations du compte").
 */
exports.updateUser = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const { name, email, role, coordinationCommunaleId, institutionSpecialiseeId, password } = req.body;

    // Même garde-fou que createUser (renommage par email) : jamais de
    // rétrogradation silencieuse d'un compte ADMIN. Cette route est
    // ADMIN-only (voir userRoutes.js) — un ADMIN qui modifierait SON
    // PROPRE rôle est donc de toute façon toujours couvert par ce même
    // garde-fou (son propre compte a lui aussi role === "ADMIN"), pas
    // besoin d'une vérification "self" séparée.
    if (role && role !== user.role) {
      if (user.role === "ADMIN") {
        return res.status(409).json({
          message: "Ce compte est ADMIN — changez son rôle manuellement dans la base si c'est vraiment voulu.",
        });
      }
      if (!["ADMIN", "EDITOR", "EC", "IS", "SUPERVISEUR", "PARTENAIRE"].includes(role)) {
        return res.status(400).json({ message: "Rôle invalide" });
      }
    }

    const nextRole = role || user.role;
    if (nextRole === "EC" && !(coordinationCommunaleId || user.coordinationCommunaleId)) {
      return res.status(400).json({ message: "coordinationCommunaleId requis pour un EC" });
    }
    if (nextRole === "IS" && !(institutionSpecialiseeId || user.institutionSpecialiseeId)) {
      return res.status(400).json({ message: "institutionSpecialiseeId requis pour un IS" });
    }

    if (email && email.toLowerCase().trim() !== user.email) {
      const emailTaken = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
      if (emailTaken) {
        return res.status(409).json({ message: "Cet email est déjà utilisé par un autre compte" });
      }
      user.email = email.toLowerCase().trim();
    }

    if (name) user.name = name;
    if (role) {
      user.role = role;
      user.coordinationCommunaleId = role === "EC" ? (coordinationCommunaleId || user.coordinationCommunaleId) : null;
      user.institutionSpecialiseeId = role === "IS" ? (institutionSpecialiseeId || user.institutionSpecialiseeId) : null;
    } else {
      if (user.role === "EC" && coordinationCommunaleId) user.coordinationCommunaleId = coordinationCommunaleId;
      if (user.role === "IS" && institutionSpecialiseeId) user.institutionSpecialiseeId = institutionSpecialiseeId;
    }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
      }
      user.password = password; // haché par le hook pre("save")
    }

    await user.save();

    getCoordinationCommunaleModel();
    getInstitutionSpecialiseeModel();
    const updated = await User.findById(user._id)
      .populate("coordinationCommunaleId", "name commune")
      .populate("institutionSpecialiseeId", "name domaine")
      .select("-password");

    res.json({ message: "Compte mis à jour avec succès", user: updated });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route DELETE /gestionamp/api/users/:id
 * @desc Supprimer définitivement un compte. Bouton "Supprimer" de
 *       UsersTable.jsx appelait jusqu'ici une route inexistante
 *       (/api/admin/users/:id, jamais montée côté serveur — bug signalé,
 *       le bouton ne faisait donc littéralement rien).
 */
exports.deleteUser = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    // Même garde-fou que toggleUserStatus : jamais se supprimer soi-même.
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ message: "Impossible de supprimer son propre compte" });
    }

    // Ne jamais permettre de supprimer le dernier compte ADMIN restant —
    // personne ne pourrait plus gérer les comptes ensuite.
    if (user.role === "ADMIN") {
      const otherAdmins = await User.countDocuments({ role: "ADMIN", _id: { $ne: user._id } });
      if (otherAdmins === 0) {
        return res.status(400).json({ message: "Impossible de supprimer le dernier compte ADMIN restant" });
      }
    }

    await user.deleteOne();

    res.json({ message: "Compte supprimé avec succès" });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};

/**
 * @route POST /gestionamp/api/users/:id/partner-logo
 * @desc ADMIN définit/corrige le logo d'un compte PARTENAIRE en particulier
 *       — en plus du self-service déjà existant côté partenaire
 *       (POST /api/volunteer-partner/me/logo), pour les cas où le
 *       partenaire ne gère pas lui-même son compte.
 */
exports.uploadPartnerLogoForUser = async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }
    if (user.role !== "PARTENAIRE") {
      return res.status(400).json({ message: "Ce compte n'est pas un partenaire" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier reçu" });
    }

    const uploaded = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "ong-site/partner-logos", resource_type: "image" },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    user.partnerLogoUrl = uploaded.secure_url;
    await user.save();

    res.json({ message: "Logo du partenaire mis à jour", partnerLogoUrl: user.partnerLogoUrl });
  } catch (error) {
    res.status(500).json({
      message: "Erreur serveur",
      error: error.message,
    });
  }
};
