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
const getUserModel = require("../models/gestionamp/User");
const Volunteer = require("../models/volunteer");
const { canReviewProgram } = require("./volunteerProgramController");
const { getDueOccurrences, computeProgress, startOfDay } = require("../utils/volunteerTaskLogic");
const { validateApplicationResponses } = require("../utils/applicationFormLogic");

/* -------------------- Interne : sous-ensemble de volontaires supervisés -------------------- */
/* Un SUPERVISEUR ne suit jamais tout un programme automatiquement — juste
   le sous-ensemble précis de volontaires qui lui a été affecté pour CE
   programme (GestionAmpUser.supervisedAssignments, jamais lu depuis le
   payload JWT — toujours rechargé frais depuis la base). Retourne `null`
   si l'utilisateur n'est pas SUPERVISEUR ou n'a aucune affectation sur ce
   programme. */
async function getSupervisorAssignment(user, programId) {
  if (user.role !== "SUPERVISEUR") return null;
  const User = getUserModel();
  const fullUser = await User.findById(user.id).select("supervisedAssignments");
  const assignment = (fullUser?.supervisedAssignments || []).find(
    (a) => a.programId.toString() === programId.toString()
  );
  return assignment || null;
}

/* -------------------- Interne : autorisation de suivi de tâches pour UN volontaire précis -------------------- */
/* Séparée de canReviewProgram (candidatures) à dessein : un SUPERVISEUR ne
   doit jamais hériter de droits sur les candidatures, uniquement sur le
   suivi de tâches de ses volontaires affectés. */
async function canSuperviseVolunteer(program, volunteerId, user) {
  if (canReviewProgram(program, user)) return true; // ADMIN/EDITOR/reviewer de candidature (mécanisme existant, inchangé)
  const assignment = await getSupervisorAssignment(user, program._id);
  if (!assignment) return false;
  return assignment.volunteerIds.some((id) => id.toString() === volunteerId.toString());
}

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

/* -------------------- Interne : statut de publication d'une tâche (brouillon/programmée/publiée) -------------------- */
/* Calcul synchrone, jamais bloqué par une écriture DB — une tâche SCHEDULED
   dont l'heure est passée compte comme publiée immédiatement, que la
   persistance ci-dessous (resolveScheduledTasks) ait déjà tourné ou non. */
function isTaskPublished(task) {
  if (task.status === "PUBLISHED") return true;
  if (task.status === "SCHEDULED" && task.scheduledPublishAt && new Date(task.scheduledPublishAt) <= new Date()) return true;
  return false;
}

const getPublishedTasks = (program) => (program.tasks || []).filter(isTaskPublished);
exports.getPublishedTasks = getPublishedTasks;

/* -------------------- Interne : republie en base les tâches SCHEDULED échues -------------------- */
/* Même pattern que closeExpiredPrograms (volunteerProgramController.js) :
   vérification paresseuse à la lecture plutôt qu'un cron. Best-effort — ne
   fait jamais échouer l'appelant si l'update échoue (isTaskPublished reste
   la source de vérité côté lecture, cette fonction ne fait que rattraper
   le champ `status` stocké pour que l'affichage admin reste cohérent). */
async function resolveScheduledTasks() {
  try {
    const Program = getVolunteerProgramModel();
    await Program.updateMany(
      { "tasks.status": "SCHEDULED", "tasks.scheduledPublishAt": { $lte: new Date() } },
      { $set: { "tasks.$[t].status": "PUBLISHED" } },
      { arrayFilters: [{ "t.status": "SCHEDULED", "t.scheduledPublishAt": { $lte: new Date() } }] }
    );
  } catch (error) {
    console.error("⚠️ Erreur resolveScheduledTasks (ignorée) :", error.message);
  }
}
exports.resolveScheduledTasks = resolveScheduledTasks;

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
    if (program.missionsFinalizedAt) {
      return res.status(409).json({ message: "Les missions de ce programme sont terminées, plus aucune soumission n'est acceptée" });
    }

    const task = (program.tasks || []).find((t) => t.id === taskId);
    if (!task) return res.status(404).json({ message: "Tâche introuvable" });
    if (!isTaskPublished(task)) return res.status(409).json({ message: "Cette tâche n'est pas encore publiée" });

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
    await resolveScheduledTasks();

    const volunteer = await Volunteer.findById(req.user.id);
    if (!volunteer) return res.status(404).json({ message: "Profil introuvable" });

    const programEntry = volunteer.programs.find((p) => p.programId.toString() === programId);
    if (!programEntry) return res.status(403).json({ message: "Vous n'êtes pas rattaché(e) à ce programme" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title tasks missionValidationThreshold endDate");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const publishedTasks = getPublishedTasks(program);

    const Submission = getVolunteerTaskSubmissionModel();
    const submissions = await Submission.find({ programId, volunteerId: volunteer._id }).lean();
    const submissionByKey = new Map(
      submissions.map((s) => [`${s.taskId}|${s.occurrenceDate ? startOfDay(s.occurrenceDate).getTime() : "once"}`, s])
    );

    const tasks = publishedTasks.map((task) => {
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

    const progress = computeProgress(publishedTasks, programEntry.assignedAt, program.endDate, submissions);

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

    const query = { programId };
    if (status) query.status = status;

    if (!canReviewProgram(program, req.user)) {
      // Pas ADMIN/EDITOR/reviewer de candidature : seul un SUPERVISEUR
      // affecté à ce programme peut continuer, et seulement sur SES
      // volontaires affectés (jamais tout le programme).
      const assignment = await getSupervisorAssignment(req.user, program._id);
      if (!assignment) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter ce programme" });
      }
      query.volunteerId = { $in: assignment.volunteerIds };
    }

    const Submission = getVolunteerTaskSubmissionModel();
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
    if (!(await canSuperviseVolunteer(program, submission.volunteerId, req.user))) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à évaluer cette soumission" });
    }

    const reviewNote = req.body?.reviewNote?.trim() || "";
    if (newStatus === "REJECTED" && !reviewNote) {
      return res.status(400).json({ message: "Une observation expliquant le motif du rejet est requise" });
    }

    submission.status = newStatus;
    submission.reviewedBy = req.user.id;
    submission.reviewedAt = new Date();
    submission.reviewNote = reviewNote;
    await submission.save();

    // Plus de promotion automatique en direct ici — le statut mission
    // (validée/refusée) ne se décide qu'au moment où le staff clique sur
    // "Terminer les missions" (voir exports.finalizeMissions), qui évalue
    // tous les volontaires du programme d'un coup.

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
    await resolveScheduledTasks();
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title tasks missionValidationThreshold endDate reviewerIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    const publishedTasks = getPublishedTasks(program);

    const volunteerQuery = { "programs.programId": programId };

    if (!canReviewProgram(program, req.user)) {
      const assignment = await getSupervisorAssignment(req.user, program._id);
      if (!assignment) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter ce programme" });
      }
      volunteerQuery._id = { $in: assignment.volunteerIds };
    }

    const volunteers = await Volunteer.find(volunteerQuery).select("nom prenom email programs");

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
      const progress = computeProgress(publishedTasks, programEntry.assignedAt, program.endDate, submissions);
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

/* -------------------- Staff : terminer les missions d'un programme (irréversible) -------------------- */
/* Bascule d'un coup tous les volontaires "Non disponible" de ce programme
   vers "Mission validée" (seuil atteint) ou "Refusé" (sinon) — c'est
   désormais le SEUL moment où ce statut se décide (reviewSubmission ne
   fait plus aucune promotion en direct à chaque approbation, voir plus
   haut). Ne touche jamais un statut déjà "Mission validée"/"Refusé"
   positionné manuellement avant. Autorisation via canReviewProgram —
   action de gestion de programme, jamais les superviseurs (suivi de
   tâches uniquement). Bloque aussi toute nouvelle soumission ensuite
   (voir submitTask). */
exports.finalizeMissions = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId)
      .select("tasks endDate missionValidationThreshold missionsFinalizedAt reviewerIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }
    if (program.missionsFinalizedAt) {
      return res.status(409).json({ message: "Les missions de ce programme ont déjà été terminées" });
    }

    const publishedTasks = getPublishedTasks(program);
    if (publishedTasks.length === 0) {
      return res.status(400).json({ message: "Ce programme n'a aucune tâche publiée à évaluer" });
    }

    const volunteers = await Volunteer.find({ "programs.programId": programId });
    const Submission = getVolunteerTaskSubmissionModel();

    let validated = 0;
    let refused = 0;

    for (const volunteer of volunteers) {
      const programEntry = volunteer.programs.find((p) => p.programId.toString() === programId);
      if (!programEntry || programEntry.statut !== "Non disponible") continue; // jamais de rétrogradation

      const submissions = await Submission.find({ programId, volunteerId: volunteer._id }).lean();
      const { percent } = computeProgress(publishedTasks, programEntry.assignedAt, program.endDate, submissions);

      if (percent >= program.missionValidationThreshold) {
        programEntry.statut = "Mission validée";
        validated += 1;
      } else {
        programEntry.statut = "Refusé";
        refused += 1;
      }
      await volunteer.save();
    }

    program.missionsFinalizedAt = new Date();
    await program.save();

    res.json({ validated, refused });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (SUPERVISEUR) : programmes qui me sont affectés -------------------- */
exports.listMySupervisedPrograms = async (req, res, next) => {
  try {
    const User = getUserModel();
    const fullUser = await User.findById(req.user.id).select("supervisedAssignments");
    const assignments = fullUser?.supervisedAssignments || [];

    const Program = getVolunteerProgramModel();
    const programs = await Program.find({ _id: { $in: assignments.map((a) => a.programId) } }).select("title");

    const items = programs.map((p) => {
      const assignment = assignments.find((a) => a.programId.toString() === p._id.toString());
      return { programId: p._id, title: p.title, volunteerCount: assignment?.volunteerIds?.length || 0 };
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

// Réutilisés par controllers/volunteerProgramPartnerController.js.
exports.getEffectiveProofFields = getEffectiveProofFields;
exports.DEFAULT_PROOF_FIELDS = DEFAULT_PROOF_FIELDS;
