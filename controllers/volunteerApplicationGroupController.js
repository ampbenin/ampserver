/**
 * Contrôleur Groupes de candidatures — Volontariat AMP Bénin
 * CRUD minimal (lister/créer/ajouter-retirer des membres/renommer/supprimer)
 * pour classer des candidatures d'un programme dans des groupes nommés,
 * réutilisables comme raccourci lors de l'affectation d'un superviseur (voir
 * volunteerProgramController.js#setSupervisorAssignment côté frontend :
 * VolunteerProgramEditor.jsx résout les membres ACCEPTED du groupe en
 * volunteerId avant de les pré-cocher — aucune logique de résolution ici).
 * Même périmètre d'autorisation que les candidatures elles-mêmes
 * (canReviewProgram) : jamais les superviseurs, qui n'ont aucun droit sur
 * les candidatures.
 */

const getVolunteerApplicationGroupModel = require("../models/volunteerApplicationGroup");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const { canReviewProgram } = require("./volunteerProgramController");

/* -------------------- Interne : vérifie l'autorisation sur un programme -------------------- */
async function assertCanManageGroups(programId, user) {
  const Program = getVolunteerProgramModel();
  const program = await Program.findById(programId);
  if (!program) return { error: 404, message: "Programme introuvable" };
  if (!canReviewProgram(program, user)) {
    return { error: 403, message: "Vous n'êtes pas autorisé à gérer les groupes de ce programme" };
  }
  return { program };
}

/* -------------------- Staff : lister les groupes d'un programme -------------------- */
exports.listGroups = async (req, res, next) => {
  try {
    const { programId } = req.query;
    if (!programId) return res.status(400).json({ message: "programId requis" });

    const auth = await assertCanManageGroups(programId, req.user);
    if (auth.error) return res.status(auth.error).json({ message: auth.message });

    const Group = getVolunteerApplicationGroupModel();
    const groups = await Group.find({ programId }).sort({ createdAt: -1 })
      .populate("applicationIds", "applicantFirstName applicantLastName applicantEmail status volunteerId");

    res.json({ items: groups });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : créer un groupe -------------------- */
exports.createGroup = async (req, res, next) => {
  try {
    const { programId, name, applicationIds } = req.body;
    if (!programId) return res.status(400).json({ message: "programId requis" });
    if (!name?.trim()) return res.status(400).json({ message: "Nom du groupe requis" });
    if (!Array.isArray(applicationIds) || applicationIds.length < 2) {
      return res.status(400).json({ message: "Sélectionnez au moins 2 candidatures pour créer un groupe" });
    }

    const auth = await assertCanManageGroups(programId, req.user);
    if (auth.error) return res.status(auth.error).json({ message: auth.message });

    // Garde-fou : n'accepte que des candidatures appartenant réellement à ce
    // programme (évite de mélanger des candidatures d'un autre programme).
    const Application = getVolunteerApplicationModel();
    const validCount = await Application.countDocuments({ _id: { $in: applicationIds }, programId });
    if (validCount !== applicationIds.length) {
      return res.status(400).json({ message: "Une ou plusieurs candidatures n'appartiennent pas à ce programme" });
    }

    const Group = getVolunteerApplicationGroupModel();
    const group = await Group.create({ programId, name: name.trim(), applicationIds, createdBy: req.user.id });
    res.status(201).json({ message: "Groupe créé", group });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : ajouter/retirer des membres d'un groupe -------------------- */
exports.addOrRemoveMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { applicationIds, action } = req.body;
    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({ message: "Aucune candidature sélectionnée" });
    }
    if (!["add", "remove"].includes(action)) {
      return res.status(400).json({ message: "action invalide (add|remove attendu)" });
    }

    const Group = getVolunteerApplicationGroupModel();
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Groupe introuvable" });

    const auth = await assertCanManageGroups(group.programId, req.user);
    if (auth.error) return res.status(auth.error).json({ message: auth.message });

    if (action === "add") {
      const Application = getVolunteerApplicationModel();
      const validCount = await Application.countDocuments({ _id: { $in: applicationIds }, programId: group.programId });
      if (validCount !== applicationIds.length) {
        return res.status(400).json({ message: "Une ou plusieurs candidatures n'appartiennent pas à ce programme" });
      }
      await Group.updateOne({ _id: groupId }, { $addToSet: { applicationIds: { $each: applicationIds } } });
    } else {
      await Group.updateOne({ _id: groupId }, { $pull: { applicationIds: { $in: applicationIds } } });
    }

    res.json({ message: "Groupe mis à jour" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : renommer un groupe -------------------- */
exports.renameGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Nom du groupe requis" });

    const Group = getVolunteerApplicationGroupModel();
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Groupe introuvable" });

    const auth = await assertCanManageGroups(group.programId, req.user);
    if (auth.error) return res.status(auth.error).json({ message: auth.message });

    group.name = name.trim();
    await group.save();
    res.json({ message: "Groupe renommé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : supprimer un groupe -------------------- */
/* Supprime uniquement le groupe (le "tag") — ne touche jamais aux
   candidatures elles-mêmes. */
exports.deleteGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const Group = getVolunteerApplicationGroupModel();
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Groupe introuvable" });

    const auth = await assertCanManageGroups(group.programId, req.user);
    if (auth.error) return res.status(auth.error).json({ message: auth.message });

    await group.deleteOne();
    res.json({ message: "Groupe supprimé" });
  } catch (error) {
    next(error);
  }
};
