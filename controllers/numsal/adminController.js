/**
 * Contrôleur d'administration — Plateforme NumSAL
 * Réservé au rôle ADMIN : créer des comptes formateur/tuteur, les gérer,
 * et affecter des apprenants à un tuteur.
 */

const crypto = require("crypto");
const Sentry = require("@sentry/node");
const getNumsalUserModel = require("../../models/numsal/NumsalUser");
const getNumsalCourseModel = require("../../models/numsal/NumsalCourse");
const getNumsalApplicationModel = require("../../models/numsal/NumsalApplication");
const getNumsalEnrollmentModel = require("../../models/numsal/NumsalEnrollment");

// Les comptes ADMIN ne sont volontairement pas gérables depuis ce panneau
// (modification/blocage/suppression/réinitialisation) — voir scripts/numsal
// pour les actions sur un compte ADMIN, exécutées manuellement en terminal.
const assertManageableRole = (user) => {
  if (user.role === "ADMIN") {
    return "Les comptes administrateurs ne sont pas gérables depuis ce panneau";
  }
  return null;
};

/**
 * @route GET /numsal/api/admin/stats
 * @desc Vue d'ensemble chiffrée de la plateforme, pour le tableau de bord admin
 */
exports.getStats = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const NumsalCourse = getNumsalCourseModel();
    const NumsalApplication = getNumsalApplicationModel();

    const [apprenants, formateurs, tuteurs, totalCourses, publishedCourses, pendingApplications] =
      await Promise.all([
        NumsalUser.countDocuments({ role: "APPRENANT" }),
        NumsalUser.countDocuments({ role: "FORMATEUR" }),
        NumsalUser.countDocuments({ role: "TUTEUR" }),
        NumsalCourse.countDocuments(),
        NumsalCourse.countDocuments({ status: "PUBLISHED" }),
        NumsalApplication.countDocuments({ status: "PENDING" }),
      ]);

    res.json({ apprenants, formateurs, tuteurs, totalCourses, publishedCourses, pendingApplications });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route POST /numsal/api/admin/users
 * @desc Créer un compte FORMATEUR ou TUTEUR (mot de passe temporaire)
 */
exports.createStaffUser = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { name, email, password, role } = req.body;

    if (!["FORMATEUR", "TUTEUR"].includes(role)) {
      return res.status(400).json({
        message: "Seuls les rôles FORMATEUR et TUTEUR peuvent être créés ici",
      });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Nom, email et mot de passe requis" });
    }

    const existing = await NumsalUser.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Un compte existe déjà avec cet email" });
    }

    const user = await NumsalUser.create({
      name,
      email,
      password,
      role,
      mustChangePassword: true,
    });

    res.status(201).json({
      message: "Compte créé avec succès",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route GET /numsal/api/admin/users?role=TUTEUR
 * @desc Lister les comptes NumSAL, filtrable par rôle
 */
exports.listUsers = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { role } = req.query;

    const query = role ? { role } : {};
    const users = await NumsalUser.find(query)
      .populate("assignedLearnerIds", "name email")
      .select("-password")
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route PATCH /numsal/api/admin/users/:id/status
 * @desc Activer / désactiver un compte
 */
exports.toggleUserStatus = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const user = await NumsalUser.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const roleError = assertManageableRole(user);
    if (roleError) return res.status(400).json({ message: roleError });

    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ message: "Impossible de modifier son propre statut" });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({ message: `Compte ${user.isActive ? "activé" : "désactivé"} avec succès` });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route PATCH /numsal/api/admin/users/:id
 * @desc Modifier le nom/email d'un compte APPRENANT, FORMATEUR ou TUTEUR
 * (les changements de rôle ne sont pas couverts ici — action plus sensible,
 * à construire séparément si un besoin réel se présente)
 */
exports.updateUser = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const user = await NumsalUser.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "Compte introuvable" });

    const roleError = assertManageableRole(user);
    if (roleError) return res.status(400).json({ message: roleError });

    const { name, email } = req.body;

    if (email !== undefined && email.toLowerCase().trim() !== user.email) {
      const existing = await NumsalUser.findOne({ email: email.toLowerCase().trim() });
      if (existing) return res.status(409).json({ message: "Un autre compte utilise déjà cet email" });
      user.email = email;
    }

    if (name !== undefined) user.name = name;

    await user.save();

    res.json({
      message: "Compte mis à jour avec succès",
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route POST /numsal/api/admin/users/:id/reset-password
 * @desc Réinitialiser directement le mot de passe d'un compte (sans passer
 * par le flux email "mot de passe oublié") — génère un mot de passe
 * temporaire renvoyé dans la réponse, à communiquer manuellement à
 * l'utilisateur. Changement forcé à la prochaine connexion.
 */
exports.resetUserPassword = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const user = await NumsalUser.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "Compte introuvable" });

    const roleError = assertManageableRole(user);
    if (roleError) return res.status(400).json({ message: roleError });

    const tempPassword = crypto.randomBytes(6).toString("hex");
    user.password = tempPassword;
    user.mustChangePassword = true;
    await user.save();

    res.json({ message: "Mot de passe réinitialisé avec succès", tempPassword });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route DELETE /numsal/api/admin/users/:id
 * @desc Supprimer définitivement un compte APPRENANT, FORMATEUR ou TUTEUR.
 *
 * FORMATEUR avec des programmes, ou TUTEUR avec des apprenants suivis
 * et/ou des programmes à évaluer : la suppression est refusée tant qu'un
 * compte de remplacement (même rôle, actif) n'est pas fourni
 * (`replacementUserId`) — tout est transféré au remplaçant avant la
 * suppression, aucune donnée n'est laissée orpheline.
 *
 * APPRENANT : ses inscriptions sont supprimées et il est retiré des listes
 * d'apprenants suivis de tout tuteur (pas de "remplacement" possible pour
 * l'identité d'un apprenant).
 */
exports.deleteUser = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const NumsalCourse = getNumsalCourseModel();
    const NumsalEnrollment = getNumsalEnrollmentModel();

    const user = await NumsalUser.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Compte introuvable" });

    const roleError = assertManageableRole(user);
    if (roleError) return res.status(400).json({ message: roleError });

    const { replacementUserId } = req.body;

    if (user.role === "FORMATEUR") {
      const ownedCourses = await NumsalCourse.find({ trainerId: user._id }).select("_id title");

      if (ownedCourses.length > 0) {
        if (!replacementUserId) {
          return res.status(409).json({
            message: `Ce formateur est responsable de ${ownedCourses.length} programme(s). Choisissez un formateur de remplacement avant de supprimer ce compte.`,
            requiresReplacement: true,
            replacementRole: "FORMATEUR",
            courses: ownedCourses.map((c) => ({ id: c._id, title: c.title })),
          });
        }

        if (replacementUserId === user._id.toString()) {
          return res.status(400).json({ message: "Le remplaçant doit être un compte différent" });
        }

        const replacement = await NumsalUser.findOne({ _id: replacementUserId, role: "FORMATEUR", isActive: true });
        if (!replacement) {
          return res.status(400).json({ message: "Formateur de remplacement introuvable ou inactif" });
        }

        await NumsalCourse.updateMany({ trainerId: user._id }, { trainerId: replacement._id });
      }
    }

    if (user.role === "TUTEUR") {
      const tutoredCourses = await NumsalCourse.find({ tutorIds: user._id }).select("_id tutorIds");
      const assignedLearnerCount = (user.assignedLearnerIds || []).length;

      if (tutoredCourses.length > 0 || assignedLearnerCount > 0) {
        if (!replacementUserId) {
          return res.status(409).json({
            message: `Ce tuteur suit ${assignedLearnerCount} apprenant(s) et/ou évalue ${tutoredCourses.length} programme(s). Choisissez un tuteur de remplacement avant de supprimer ce compte.`,
            requiresReplacement: true,
            replacementRole: "TUTEUR",
            courseCount: tutoredCourses.length,
            assignedLearnerCount,
          });
        }

        if (replacementUserId === user._id.toString()) {
          return res.status(400).json({ message: "Le remplaçant doit être un compte différent" });
        }

        const replacement = await NumsalUser.findOne({ _id: replacementUserId, role: "TUTEUR", isActive: true });
        if (!replacement) {
          return res.status(400).json({ message: "Tuteur de remplacement introuvable ou inactif" });
        }

        // Fusionne le suivi des apprenants (sans doublons) vers le remplaçant.
        const mergedLearnerIds = Array.from(
          new Set([
            ...replacement.assignedLearnerIds.map((id) => id.toString()),
            ...user.assignedLearnerIds.map((id) => id.toString()),
          ])
        );
        replacement.assignedLearnerIds = mergedLearnerIds;
        await replacement.save();

        // Remplace ce tuteur par le remplaçant dans chaque programme rattaché.
        for (const course of tutoredCourses) {
          const nextTutorIds = Array.from(
            new Set([
              ...course.tutorIds.map((id) => id.toString()).filter((id) => id !== user._id.toString()),
              replacement._id.toString(),
            ])
          );
          await NumsalCourse.updateOne({ _id: course._id }, { tutorIds: nextTutorIds });
        }
      }
    }

    if (user.role === "APPRENANT") {
      await NumsalEnrollment.deleteMany({ learnerId: user._id });
      await NumsalUser.updateMany({ assignedLearnerIds: user._id }, { $pull: { assignedLearnerIds: user._id } });
    }

    await user.deleteOne();

    res.json({ message: "Compte supprimé avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route PATCH /numsal/api/admin/tutors/:id/assign-learners
 * @desc Remplacer la liste des apprenants suivis par un tuteur
 */
exports.assignLearnersToTutor = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const { learnerIds } = req.body;

    if (!Array.isArray(learnerIds)) {
      return res.status(400).json({ message: "learnerIds doit être un tableau" });
    }

    const tutor = await NumsalUser.findById(req.params.id);
    if (!tutor || tutor.role !== "TUTEUR") {
      return res.status(404).json({ message: "Tuteur introuvable" });
    }

    const learnerCount = await NumsalUser.countDocuments({
      _id: { $in: learnerIds },
      role: "APPRENANT",
    });
    if (learnerCount !== learnerIds.length) {
      return res.status(400).json({ message: "Un ou plusieurs identifiants ne correspondent pas à des apprenants" });
    }

    tutor.assignedLearnerIds = learnerIds;
    await tutor.save();

    res.json({ message: "Affectation mise à jour avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route GET /numsal/api/admin/courses
 * @desc Lister tous les programmes (tous formateurs confondus), pour
 * l'écran d'affectation des tuteurs
 */
exports.listAllCourses = async (req, res) => {
  try {
    const NumsalCourse = getNumsalCourseModel();
    const courses = await NumsalCourse.find()
      .select("title status modality accessMode trainerId tutorIds")
      .populate("trainerId", "name")
      .populate("tutorIds", "name email")
      .sort({ createdAt: -1 });

    res.json(courses);
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * @route PATCH /numsal/api/admin/courses/:id/assign-tutors
 * @desc Remplacer la liste des tuteurs rattachés à un programme (droit
 * d'évaluer ses candidatures, en plus du formateur propriétaire)
 */
exports.assignTutorsToCourse = async (req, res) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const NumsalCourse = getNumsalCourseModel();
    const { tutorIds } = req.body;

    if (!Array.isArray(tutorIds)) {
      return res.status(400).json({ message: "tutorIds doit être un tableau" });
    }

    const course = await NumsalCourse.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: "Programme introuvable" });
    }

    const tutorCount = await NumsalUser.countDocuments({
      _id: { $in: tutorIds },
      role: "TUTEUR",
    });
    if (tutorCount !== tutorIds.length) {
      return res.status(400).json({ message: "Un ou plusieurs identifiants ne correspondent pas à des tuteurs" });
    }

    course.tutorIds = tutorIds;
    await course.save();

    res.json({ message: "Affectation mise à jour avec succès" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
