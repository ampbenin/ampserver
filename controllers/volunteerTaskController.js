/**
 * Contrôleur Suivi des tâches de mission — Programmes de volontariat AMP Bénin
 * Un volontaire accepté à un programme soumet une preuve par tâche/échéance
 * due, le staff approuve/rejette — voir le plan de ce chantier pour le
 * raisonnement complet (occurrences dues, seuil de validation automatique).
 */

const streamifier = require("streamifier");
const cloudinary = require("../utils/cloudinary");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerTaskSubmissionModel = require("../models/volunteerTaskSubmission");
const Volunteer = require("../models/volunteer");
const { canReviewProgram } = require("./volunteerProgramController");
const { getDueOccurrences, computeProgress, startOfDay } = require("../utils/volunteerTaskLogic");
const { validateApplicationResponses } = require("../utils/applicationFormLogic");

// Repli utilisé quand une tâche n'a aucun champ de preuve configuré (tâches
// créées avant ce chantier, ou staff n'ayant pas encore personnalisé) — un
// simple champ Description obligatoire, jamais un formulaire vide.
const DEFAULT_PROOF_FIELDS = [
  {
    id: "description", label: "Description", type: "TEXTAREA", required: true,
    locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] },
  },
];

const getEffectiveProofFields = (task) =>
  (task.proofForm?.fields?.length > 0) ? task.proofForm.fields : DEFAULT_PROOF_FIELDS;

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
    const { programId, taskId, occurrenceDate, responses } = req.body;
    if (!programId || !taskId) {
      return res.status(400).json({ message: "Programme et tâche requis" });
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

    const proofFields = getEffectiveProofFields(task);
    const validationError = validateApplicationResponses(proofFields, responses || {});
    if (validationError) return res.status(400).json({ message: validationError });

    const Submission = getVolunteerTaskSubmissionModel();
    await Submission.findOneAndUpdate(
      { programId, volunteerId: volunteer._id, taskId, occurrenceDate: occurrenceKey },
      {
        responses: responses || {},
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

/* -------------------- Protégé (Mon espace) : uploader une image de preuve -------------------- */
/* Une image à la fois — le volontaire peut appeler cet endpoint plusieurs
   fois pour un champ IMAGE acceptant plusieurs photos (voir ProgramProgress.jsx),
   accumulant les URLs Cloudinary côté client avant l'envoi final du formulaire.
   Mirror de controllers/numsal/testimonialController.js#uploadPhoto. */
exports.uploadProofImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

    const uploaded = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "ong-site/volunteer-tasks", resource_type: "image" },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    res.status(201).json({ url: uploaded.secure_url });
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
          responses: submission?.responses || {},
          reviewNote: submission?.reviewNote || "",
        };
      });
      return {
        id: task.id, title: task.title, description: task.description, recurrence: task.recurrence,
        proofFields: getEffectiveProofFields(task),
        occurrences,
      };
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
        proofFields: task ? getEffectiveProofFields(task) : DEFAULT_PROOF_FIELDS,
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
