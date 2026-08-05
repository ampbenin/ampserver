/**
 * Contrôleur Suivi des tâches de mission — Programmes de volontariat AMP Bénin
 * Un volontaire accepté à un programme soumet une preuve par tâche/échéance
 * due, le staff approuve/rejette — voir le plan de ce chantier pour le
 * raisonnement complet (occurrences dues, seuil de validation automatique).
 */

const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerTaskSubmissionModel = require("../models/volunteerTaskSubmission");
const Volunteer = require("../models/volunteer");
const { canReviewProgram } = require("./volunteerProgramController");
const { getDueOccurrences, computeProgress, startOfDay } = require("../utils/volunteerTaskLogic");

/* -------------------- Interne : recalcule et promeut le statut si le seuil est atteint -------------------- */
/* Ne fait JAMAIS de rétrogradation (voir le plan) : ne touche ni "Refusé" ni
   un "Mission validée" déjà positionné, ne promeut que depuis "Non disponible". */
async function recalculateMissionStatus(program, volunteerId) {
  if (!program.tasks || program.tasks.length === 0) return;

  const volunteer = await Volunteer.findById(volunteerId);
  if (!volunteer) return;

  const programEntry = volunteer.programs.find((p) => p.programId.toString() === program._id.toString());
  if (!programEntry || programEntry.statut !== "Non disponible") return;

  const Submission = getVolunteerTaskSubmissionModel();
  const submissions = await Submission.find({ programId: program._id, volunteerId }).lean();
  const { percent } = computeProgress(program.tasks, programEntry.assignedAt, program.endDate, submissions);

  if (percent >= program.missionValidationThreshold) {
    programEntry.statut = "Mission validée";
    await volunteer.save();
  }
}

/* -------------------- Protégé (Mon espace) : soumettre une preuve -------------------- */
exports.submitTask = async (req, res, next) => {
  try {
    const { programId, taskId, occurrenceDate, proofText, proofUrl } = req.body;
    if (!programId || !taskId) {
      return res.status(400).json({ message: "Programme et tâche requis" });
    }
    if (!proofText && !proofUrl) {
      return res.status(400).json({ message: "Merci de fournir une preuve (texte ou lien)" });
    }

    const volunteer = await Volunteer.findById(req.user.id);
    if (!volunteer) return res.status(404).json({ message: "Profil introuvable" });

    const programEntry = volunteer.programs.find((p) => p.programId.toString() === programId);
    if (!programEntry) return res.status(403).json({ message: "Vous n'êtes pas rattaché(e) à ce programme" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const task = (program.tasks || []).find((t) => t.id === taskId);
    if (!task) return res.status(404).json({ message: "Tâche introuvable" });

    let occurrenceKey = null;
    if (task.recurrence !== "ONCE") {
      if (!occurrenceDate) return res.status(400).json({ message: "Échéance requise pour cette tâche" });
      const due = getDueOccurrences(task, programEntry.assignedAt, program.endDate);
      const match = due.find((d) => d.getTime() === startOfDay(occurrenceDate).getTime());
      if (!match) return res.status(400).json({ message: "Cette échéance n'est pas (encore) due" });
      occurrenceKey = match;
    }

    const Submission = getVolunteerTaskSubmissionModel();
    await Submission.findOneAndUpdate(
      { programId, volunteerId: volunteer._id, taskId, occurrenceDate: occurrenceKey },
      {
        proofText: proofText || "",
        proofUrl: proofUrl || "",
        status: "PENDING",
        submittedAt: new Date(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: "",
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ message: "Preuve soumise, en attente de validation." });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (Mon espace) : ma progression sur un programme -------------------- */
exports.getMyProgramProgress = async (req, res, next) => {
  try {
    const { programId } = req.params;

    const volunteer = await Volunteer.findById(req.user.id);
    if (!volunteer) return res.status(404).json({ message: "Profil introuvable" });

    const programEntry = volunteer.programs.find((p) => p.programId.toString() === programId);
    if (!programEntry) return res.status(403).json({ message: "Vous n'êtes pas rattaché(e) à ce programme" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title tasks missionValidationThreshold endDate");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const Submission = getVolunteerTaskSubmissionModel();
    const submissions = await Submission.find({ programId, volunteerId: volunteer._id }).lean();
    const submissionByKey = new Map(
      submissions.map((s) => [`${s.taskId}|${s.occurrenceDate ? startOfDay(s.occurrenceDate).getTime() : "once"}`, s])
    );

    const tasks = (program.tasks || []).map((task) => {
      const due = getDueOccurrences(task, programEntry.assignedAt, program.endDate);
      const occurrences = due.map((occurrenceDate) => {
        const key = `${task.id}|${occurrenceDate ? occurrenceDate.getTime() : "once"}`;
        const submission = submissionByKey.get(key);
        return {
          occurrenceDate,
          status: submission?.status || "TODO",
          proofText: submission?.proofText || "",
          proofUrl: submission?.proofUrl || "",
          reviewNote: submission?.reviewNote || "",
        };
      });
      return { id: task.id, title: task.title, description: task.description, recurrence: task.recurrence, occurrences };
    });

    const progress = computeProgress(program.tasks || [], programEntry.assignedAt, program.endDate, submissions);

    res.json({
      programTitle: program.title,
      missionValidationThreshold: program.missionValidationThreshold,
      missionStatus: programEntry.statut,
      tasks,
      progress,
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : file de modération des soumissions -------------------- */
exports.listSubmissions = async (req, res, next) => {
  try {
    const { programId, status } = req.query;
    if (!programId) return res.status(400).json({ message: "programId requis" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter ce programme" });
    }

    const Submission = getVolunteerTaskSubmissionModel();
    const query = { programId };
    if (status) query.status = status;
    const submissions = await Submission.find(query).sort({ submittedAt: -1 }).lean();

    const volunteerIds = [...new Set(submissions.map((s) => String(s.volunteerId)))];
    const volunteers = volunteerIds.length > 0
      ? await Volunteer.find({ _id: { $in: volunteerIds } }).select("nom prenom email")
      : [];
    const volunteerById = new Map(volunteers.map((v) => [String(v._id), v]));
    const taskById = new Map((program.tasks || []).map((t) => [t.id, t]));

    const items = submissions.map((s) => {
      const volunteer = volunteerById.get(String(s.volunteerId));
      const task = taskById.get(s.taskId);
      return {
        ...s,
        volunteerName: volunteer ? `${volunteer.prenom} ${volunteer.nom}` : "Volontaire introuvable",
        volunteerEmail: volunteer?.email || "",
        taskTitle: task?.title || "Tâche supprimée",
      };
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : approuver/rejeter une soumission -------------------- */
async function reviewSubmission(req, res, next, newStatus) {
  try {
    const Submission = getVolunteerTaskSubmissionModel();
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: "Soumission introuvable" });
    if (submission.status !== "PENDING") {
      return res.status(409).json({ message: "Cette soumission a déjà été traitée" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(submission.programId);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à évaluer ce programme" });
    }

    submission.status = newStatus;
    submission.reviewedBy = req.user.id;
    submission.reviewedAt = new Date();
    submission.reviewNote = req.body?.reviewNote || "";
    await submission.save();

    if (newStatus === "APPROVED") {
      await recalculateMissionStatus(program, submission.volunteerId);
    }

    res.json({ message: newStatus === "APPROVED" ? "Tâche approuvée" : "Tâche rejetée" });
  } catch (error) {
    next(error);
  }
}

exports.approveSubmission = (req, res, next) => reviewSubmission(req, res, next, "APPROVED");
exports.rejectSubmission = (req, res, next) => reviewSubmission(req, res, next, "REJECTED");

/* -------------------- Staff : progression de tous les volontaires d'un programme -------------------- */
exports.listProgramProgress = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title tasks missionValidationThreshold endDate reviewerIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter ce programme" });
    }

    const volunteers = await Volunteer.find({ "programs.programId": programId }).select("nom prenom email programs");

    const Submission = getVolunteerTaskSubmissionModel();
    const allSubmissions = await Submission.find({ programId }).lean();
    const submissionsByVolunteer = new Map();
    allSubmissions.forEach((s) => {
      const key = String(s.volunteerId);
      if (!submissionsByVolunteer.has(key)) submissionsByVolunteer.set(key, []);
      submissionsByVolunteer.get(key).push(s);
    });

    const items = volunteers.map((v) => {
      const programEntry = v.programs.find((p) => p.programId.toString() === programId);
      const submissions = submissionsByVolunteer.get(String(v._id)) || [];
      const progress = computeProgress(program.tasks || [], programEntry.assignedAt, program.endDate, submissions);
      return {
        volunteerId: v._id,
        nom: v.nom,
        prenom: v.prenom,
        email: v.email,
        statut: programEntry.statut,
        progress,
      };
    });

    res.json({ items, missionValidationThreshold: program.missionValidationThreshold });
  } catch (error) {
    next(error);
  }
};
