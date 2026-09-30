/**
 * Contrôleur CRUD admin pour les offres de recrutement (JobPosting) —
 * remplace makeSimpleCrud pour ce modèle spécifiquement : contrairement à
 * Action (qui garde makeSimpleCrud, aucune notion d'affectation), une offre
 * porte désormais des droits délégués par personne (staffAccess, décision
 * utilisateur 2026-09-30) qui nécessitent une vérification par item, chose
 * que le CRUD générique ne fait pas du tout.
 *
 * Tout compte non-ADMIN (EDITOR, mais aussi EC/IS/SUPERVISEUR/PARTENAIRE
 * depuis 2026-09-30) n'a plus d'accès total à toutes les offres par défaut —
 * il ne gère que celles où il apparaît dans staffAccess, avec exactement
 * les droits cochés (même bascule que VolunteerProgram.editorIds le
 * 2026-08-17, voir controllers/volunteerProgramController.js#canReviewProgram,
 * mais plus granulaire ici : 3 booléens indépendants au lieu d'un accès
 * binaire tout-ou-rien).
 *
 * Créer/supprimer une offre reste réservé à ADMIN — volontairement non
 * délégable via staffAccess (décision utilisateur), donc pas de vérification
 * par item sur create/remove, juste roleMiddleware au niveau route.
 */

const getJobPostingModel = require("../../models/cms/JobPosting");
const getUserModel = require("../../models/gestionamp/User");

/* Calcule les droits de `user` sur `job` — ADMIN a toujours tout, sinon on
   cherche son entrée dans staffAccess. canReviewApplications implique
   canViewApplications (étudier permet forcément de voir). */
const getJobAccess = (job, user) => {
  if (user.role === "ADMIN") {
    return { canEditForm: true, canViewApplications: true, canReviewApplications: true, isAdmin: true };
  }
  const entry = (job.staffAccess || []).find((a) => a.userId.toString() === user.id);
  if (!entry) {
    return { canEditForm: false, canViewApplications: false, canReviewApplications: false, isAdmin: false };
  }
  return {
    canEditForm: !!entry.canEditForm,
    canViewApplications: !!entry.canViewApplications || !!entry.canReviewApplications,
    canReviewApplications: !!entry.canReviewApplications,
    isAdmin: false,
  };
};
exports.getJobAccess = getJobAccess;

const hasAnyAccess = (access) => access.canEditForm || access.canViewApplications || access.canReviewApplications;

/* -------------------- Staff : liste complète (gestion) -------------------- */
/* ADMIN voit toutes les offres ; un EDITOR ne voit que celles où il a au
   moins un droit dans staffAccess (même s'il ne peut, par ex., que voir les
   candidatures — il doit quand même la retrouver dans sa liste). */
exports.adminList = async (req, res, next) => {
  try {
    const Model = getJobPostingModel();
    const query = req.user.role === "ADMIN" ? {} : { "staffAccess.userId": req.user.id };
    const items = await Model.find(query).sort({ order: 1, createdAt: -1 });
    const withAccess = items.map((item) => {
      const obj = item.toObject();
      obj.myAccess = getJobAccess(item, req.user);
      return obj;
    });
    res.json({ success: true, items: withAccess });
  } catch (error) {
    next(error);
  }
};

exports.adminGetById = async (req, res, next) => {
  try {
    const Model = getJobPostingModel();
    const item = await Model.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Offre non trouvée" });

    const access = getJobAccess(item, req.user);
    if (!hasAnyAccess(access)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à accéder à cette offre" });
    }

    const obj = item.toObject();
    obj.myAccess = access;
    res.json(obj);
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : créer/supprimer -------------------- */
/* Volontairement non délégable via staffAccess (décision utilisateur) —
   ADMIN gère le roster d'offres, puis délègue la gestion du contenu d'une
   offre existante via l'affectation. */
exports.create = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Seul un ADMIN peut créer une offre" });
    }
    const Model = getJobPostingModel();
    const { staffAccess, ...body } = req.body; // staffAccess ne se gère que via setStaffAccess
    const item = await Model.create({ ...body, updatedBy: req.user.id });
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Seul un ADMIN peut supprimer une offre" });
    }
    const Model = getJobPostingModel();
    const deleted = await Model.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Offre non trouvée" });
    res.json({ success: true, message: "Offre supprimée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : modifier le contenu d'une offre existante -------------------- */
exports.update = async (req, res, next) => {
  try {
    const Model = getJobPostingModel();
    const item = await Model.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Offre non trouvée" });

    const access = getJobAccess(item, req.user);
    if (!access.canEditForm) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à modifier cette offre" });
    }

    // staffAccess ne se gère que via setStaffAccess (ADMIN uniquement) —
    // jamais via cette route générique, même pour un ADMIN (évite un body
    // partiel qui écraserait des affectations existantes par erreur).
    const { staffAccess, ...body } = req.body;
    const updated = await Model.findByIdAndUpdate(
      req.params.id,
      { ...body, updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    const obj = updated.toObject();
    obj.myAccess = getJobAccess(updated, req.user);
    res.json(obj);
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : gérer les affectations -------------------- */
/* Vérifie que le compte visé est bien un EDITOR (même contrôle que
   volunteerProgramController.js#setEditorAccess) — seuls ADMIN/EDITOR
   peuvent se connecter au panneau admin (AdminShell.jsx), donc "affecter
   quelqu'un" veut toujours dire affecter un compte EDITOR. Retire
   l'entrée si les 3 droits sont à false plutôt que de laisser une entrée
   vide sans effet. */
exports.setStaffAccess = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Seul un ADMIN peut gérer les accès" });
    }
    const { userId, canEditForm, canViewApplications, canReviewApplications } = req.body;
    if (!userId) return res.status(400).json({ message: "userId requis" });

    const Model = getJobPostingModel();
    const item = await Model.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Offre non trouvée" });

    const User = getUserModel();
    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ message: "Compte introuvable" });
    // Tout rôle sauf ADMIN est affectable (décision utilisateur, 2026-09-30
    // — élargi depuis EDITOR seul) : EC, IS, SUPERVISEUR, PARTENAIRE aussi,
    // via leur propre tableau de bord (voir RecruitmentAssignedPanel.jsx),
    // pas seulement /admin/dashboard.
    if (targetUser.role === "ADMIN") {
      return res.status(400).json({ message: "Un compte ADMIN a déjà accès à tout, inutile de l'affecter" });
    }

    const hasAny = !!canEditForm || !!canViewApplications || !!canReviewApplications;
    item.staffAccess = item.staffAccess.filter((a) => a.userId.toString() !== userId);
    if (hasAny) {
      item.staffAccess.push({
        userId,
        canEditForm: !!canEditForm,
        canViewApplications: !!canViewApplications,
        canReviewApplications: !!canReviewApplications,
      });
    }
    await item.save();

    res.json({ success: true, staffAccess: item.staffAccess });
  } catch (error) {
    next(error);
  }
};
