/**
 * Contrôleur Notes de suivi — Plateforme NumSAL
 * Un tuteur laisse des notes/encouragements pour ses apprenants assignés.
 * Append-only en MVP (pas d'édition), lecture aussi ouverte à l'ADMIN
 * pour supervision.
 */

const getNumsalMentorNoteModel = require("../../models/numsal/NumsalMentorNote");
const getNumsalUserModel = require("../../models/numsal/NumsalUser");

const isAssignedToTutor = async (tutorId, learnerId) => {
  const NumsalUser = getNumsalUserModel();
  const tutor = await NumsalUser.findById(tutorId);
  return !!tutor?.assignedLearnerIds?.some((id) => id.toString() === learnerId);
};

/* -------------------- Tuteur : ajouter une note -------------------- */
exports.addNote = async (req, res, next) => {
  try {
    const { learnerId, note } = req.body;
    if (!learnerId || !note) {
      return res.status(400).json({ message: "learnerId et note requis" });
    }

    const assigned = await isAssignedToTutor(req.user.id, learnerId);
    if (!assigned) {
      return res.status(403).json({ message: "Cet apprenant ne vous est pas assigné" });
    }

    const MentorNote = getNumsalMentorNoteModel();
    const created = await MentorNote.create({ tutorId: req.user.id, learnerId, note });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Tuteur (ou ADMIN) : historique des notes d'un apprenant -------------------- */
exports.listNotesForLearner = async (req, res, next) => {
  try {
    const { learnerId } = req.params;

    if (req.user.role === "TUTEUR") {
      const assigned = await isAssignedToTutor(req.user.id, learnerId);
      if (!assigned) {
        return res.status(403).json({ message: "Cet apprenant ne vous est pas assigné" });
      }
    }

    const MentorNote = getNumsalMentorNoteModel();
    const notes = await MentorNote.find({ learnerId }).sort({ createdAt: -1 });

    res.json({ items: notes });
  } catch (error) {
    next(error);
  }
};
