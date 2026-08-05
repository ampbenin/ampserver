/**
 * Contrôleur de gestion des utilisateurs
 * Accès strictement réservé aux ADMIN
 */

const getUserModel = require("../../models/gestionamp/User");

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

    // Vérification du rôle autorisé
    if (!["EC", "IS", "EDITOR", "SUPERVISEUR", "PARTENAIRE"].includes(role)) {
      return res.status(400).json({
        message: "Seuls les rôles EC, IS, EDITOR, SUPERVISEUR et PARTENAIRE peuvent être créés",
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
 * @route GET /gestionamp/api/users
 * @desc Lister tous les utilisateurs (ADMIN)
 */
exports.getAllUsers = async (req, res) => {
  try {
    const User = getUserModel();
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
