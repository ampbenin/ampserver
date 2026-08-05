/**
 * Contrôleur "Compte partenaire" — Programmes de volontariat AMP Bénin
 * Lecture seule des statistiques/impact/résultats d'un ou plusieurs
 * programmes suivis (GestionAmpUser.partnerProgramIds), jamais les tâches
 * rejetées/en attente — uniquement les volontaires à "Mission validée" et
 * leurs tâches APPROUVÉES. Les partenaires peuvent aussi poster un
 * commentaire, visible seulement par ADMIN/EDITOR (voir listPartnerComments).
 */

const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerTaskSubmissionModel = require("../models/volunteerTaskSubmission");
const getVolunteerProgramPartnerCommentModel = require("../models/volunteerProgramPartnerComment");
const getUserModel = require("../models/gestionamp/User");
const Volunteer = require("../models/volunteer");
const { computeProgress } = require("../utils/volunteerTaskLogic");
const { getEffectiveProofFields } = require("./volunteerTaskController");

/* -------------------- Interne : vérifie que ce partenaire suit bien ce programme -------------------- */
async function assertPartnerAccess(userId, programId) {
  const User = getUserModel();
  const partner = await User.findById(userId).select("partnerProgramIds");
  return (partner?.partnerProgramIds || []).some((id) => id.toString() === programId.toString());
}

/* -------------------- Protégé (PARTENAIRE) : programmes suivis -------------------- */
exports.listMyPartnerPrograms = async (req, res, next) => {
  try {
    const User = getUserModel();
    const partner = await User.findById(req.user.id).select("partnerProgramIds");
    const Program = getVolunteerProgramModel();
    const programs = await Program.find({ _id: { $in: partner?.partnerProgramIds || [] } })
      .select("title location startDate endDate status");
    res.json({ items: programs });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : statistiques/impact/résultats d'un programme -------------------- */
exports.getPartnerProgramStats = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId)
      .select("title description location startDate endDate tasks missionValidationThreshold");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const volunteers = await Volunteer.find({ "programs.programId": programId }).select("nom prenom programs");
    const Submission = getVolunteerTaskSubmissionModel();
    const allSubmissions = await Submission.find({ programId }).lean();
    const submissionsByVolunteer = new Map();
    allSubmissions.forEach((s) => {
      const key = String(s.volunteerId);
      if (!submissionsByVolunteer.has(key)) submissionsByVolunteer.set(key, []);
      submissionsByVolunteer.get(key).push(s);
    });
    const taskById = new Map((program.tasks || []).map((t) => [t.id, t]));

    let percentSum = 0;
    let totalApproved = 0;
    let validatedCount = 0;
    const validatedVolunteers = [];

    for (const v of volunteers) {
      const programEntry = v.programs.find((p) => p.programId.toString() === programId);
      const submissions = submissionsByVolunteer.get(String(v._id)) || [];
      const progress = computeProgress(program.tasks || [], programEntry.assignedAt, program.endDate, submissions);
      percentSum += progress.percent;
      totalApproved += submissions.filter((s) => s.status === "APPROVED").length;

      if (programEntry.statut === "Mission validée") {
        validatedCount += 1;
        const approvedTasks = submissions
          .filter((s) => s.status === "APPROVED")
          .map((s) => {
            const task = taskById.get(s.taskId);
            return {
              taskTitle: task?.title || "Tâche",
              occurrenceDate: s.occurrenceDate,
              responses: s.responses,
              proofFields: task ? getEffectiveProofFields(task) : [],
            };
          });
        validatedVolunteers.push({ volunteerId: v._id, nom: v.nom, prenom: v.prenom, approvedTasks });
      }
    }

    res.json({
      program: {
        title: program.title, description: program.description, location: program.location,
        startDate: program.startDate, endDate: program.endDate,
      },
      stats: {
        totalVolunteers: volunteers.length,
        validatedVolunteers: validatedCount,
        percentValidated: volunteers.length > 0 ? Math.round((validatedCount / volunteers.length) * 100) : 0,
        averageProgress: volunteers.length > 0 ? Math.round(percentSum / volunteers.length) : 0,
        totalApprovedTasks: totalApproved,
      },
      validatedVolunteers,
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : poster un commentaire/suggestion -------------------- */
exports.submitPartnerComment = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ message: "Le commentaire ne peut pas être vide" });
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Comment = getVolunteerProgramPartnerCommentModel();
    await Comment.create({ programId, partnerId: req.user.id, text: text.trim() });
    res.status(201).json({ message: "Commentaire envoyé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR uniquement) : journal des commentaires partenaires -------------------- */
exports.listPartnerComments = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const Comment = getVolunteerProgramPartnerCommentModel();
    const comments = await Comment.find({ programId }).sort({ createdAt: -1 });

    const User = getUserModel();
    const partnerIds = [...new Set(comments.map((c) => String(c.partnerId)))];
    const partners = partnerIds.length > 0 ? await User.find({ _id: { $in: partnerIds } }).select("name email") : [];
    const partnerById = new Map(partners.map((p) => [String(p._id), p]));

    const items = comments.map((c) => ({
      _id: c._id,
      text: c.text,
      createdAt: c.createdAt,
      partnerName: partnerById.get(String(c.partnerId))?.name || "Partenaire",
      partnerEmail: partnerById.get(String(c.partnerId))?.email || "",
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};
