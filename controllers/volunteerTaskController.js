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
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getVolunteerApplicationGroupModel = require("../models/volunteerApplicationGroup");
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

/* -------------------- Interne : tâches publiées HORS rapport de fin de mission -------------------- */
/* Le rapport de fin de mission (task.isFinalReport) ne compte jamais dans
   le % de progression (décision utilisateur, 2026-08-19) — utilisé à la
   place de getPublishedTasks partout où computeProgress est appelé.
   getPublishedTasks (non filtrée) reste utilisée pour l'affichage complet
   de la liste des tâches : le rapport final doit rester visible, juste
   exclu du calcul. */
const getRegularTasks = (program) => getPublishedTasks(program).filter((t) => !t.isFinalReport);

/* -------------------- Interne : mission déjà clôturée pour ce volontaire sur ce programme -------------------- */
/* Un statut différent de "Non disponible" signifie que la mission de ce
   volontaire est déjà tranchée — soit via l'approbation de son rapport de
   fin de mission (clôture individuelle immédiate, voir reviewSubmission),
   soit via "Terminer les missions" (balayage global, voir
   finalizeMissions). Dans les deux cas, plus aucune tâche/rapport n'est
   modifiable pour ce volontaire ensuite (décision utilisateur,
   2026-08-19), sauf réactivation ciblée du rapport final (voir
   reactivateFinalReport / programEntry.finalReportReopenedAt). */
const isVolunteerMissionClosed = (programEntry) => programEntry.statut !== "Non disponible";

/* -------------------- Interne : republie en base les tâches SCHEDULED échues -------------------- */
/* Même pattern que closeExpiredPrograms (volunteerProgramController.js) :
   vérification paresseuse à la lecture plutôt qu'un cron. Best-effort — ne
   fait jamais échouer l'appelant si l'update échoue (isTaskPublished reste
   la source de vérité côté lecture, cette fonction ne fait que rattraper
   le champ `status` stocké pour que l'affichage admin reste cohérent). */
async function resolveScheduledTasks() {
  try {
    const Program = getVolunteerProgramModel();
    const now = new Date();
    await Program.updateMany(
      { "tasks.status": "SCHEDULED", "tasks.scheduledPublishAt": { $lte: now } },
      // publishedAt = l'instant réel de la publication automatique, jamais
      // scheduledPublishAt (qui n'est que l'heure CIBLE) — ce updateMany ne
      // matche chaque tâche qu'une seule fois (le filtre exige
      // status:"SCHEDULED", qui devient "PUBLISHED" juste après), donc
      // aucun risque d'écraser un publishedAt déjà posé.
      { $set: { "tasks.$[t].status": "PUBLISHED", "tasks.$[t].publishedAt": now } },
      { arrayFilters: [{ "t.status": "SCHEDULED", "t.scheduledPublishAt": { $lte: now } }] }
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

    const task = (program.tasks || []).find((t) => t.id === taskId);
    if (!task) return res.status(404).json({ message: "Tâche introuvable" });
    if (!isTaskPublished(task)) return res.status(409).json({ message: "Cette tâche n'est pas encore publiée" });

    // Mission déjà clôturée pour CE volontaire (via son rapport final
    // approuvé, ou "Terminer les missions", qui pose aussi
    // program.missionsFinalizedAt) — plus aucune soumission, sauf
    // réactivation ciblée du rapport final (décision utilisateur,
    // 2026-08-19 : "même si la mission est marquée terminée"), qui doit
    // bypasser TOUS les verrous qui bloqueraient sinon cette tâche-là en
    // particulier — y compris sa propre date limite (task.dueAt) : en
    // pratique, un rapport final n'est réactivé qu'APRÈS que sa date
    // limite soit passée (c'est même une condition pour que "Terminer les
    // missions" ait pu tourner, voir finalizeMissions), donc sans ce
    // bypass la réactivation serait toujours immédiatement inutilisable.
    const finalReportReopened = task.isFinalReport && !!programEntry.finalReportReopenedAt;

    if (!finalReportReopened && task.dueAt && new Date(task.dueAt) <= new Date()) {
      return res.status(409).json({ message: "Le délai de soumission pour cette tâche est dépassé" });
    }
    if (!finalReportReopened) {
      if (program.missionsFinalizedAt) {
        return res.status(409).json({ message: "Les missions de ce programme sont terminées, plus aucune soumission n'est acceptée" });
      }
      if (isVolunteerMissionClosed(programEntry)) {
        return res.status(409).json({ message: "Votre mission sur ce programme est terminée, plus aucune soumission n'est possible" });
      }
    }

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
        // Figé au moment de CETTE soumission (voir models/volunteerTaskSubmission.js) —
        // une resoumission après rejet reprend les champs éventuellement
        // mis à jour depuis, jamais l'ancienne copie.
        proofFieldsSnapshot: proofFields,
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
    // brandColor ajouté (2026-08-19) pour TaskTypeformForm.jsx — même
    // dérivation de palette que VolunteerApplicationForm.jsx (le
    // volontaire n'a accès ni à GET /api/volunteer-programs/:id ni à
    // /application-form une fois accepté, cette réponse est sa seule
    // source côté "Mon espace").
    const program = await Program.findById(programId).select("title tasks missionValidationThreshold endDate brandColor");
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
          // Horodatages "style WhatsApp" affichés côté volontaire (décision
          // utilisateur, 2026-08-18) — jamais reviewedBy (identité du
          // staff), volontairement absent ici.
          submittedAt: submission?.submittedAt || null,
          reviewedAt: submission?.reviewedAt || null,
        };
      });
      return {
        id: task.id, title: task.title, description: task.description, recurrence: task.recurrence,
        proofFields: getEffectiveProofFields(task),
        publishedAt: task.publishedAt || null,
        dueAt: task.dueAt || null,
        // Affichage spécial du rapport de fin de mission côté
        // ProgramProgress.jsx (section à part, jamais mélangé aux
        // occurrences filtrées) + lien Typeform si displayStyle le prévoit
        // (décision utilisateur, 2026-08-19).
        isFinalReport: !!task.isFinalReport,
        displayStyle: task.displayStyle || "STANDARD",
        occurrences,
      };
    });

    // Le rapport de fin de mission ne compte jamais dans le % (voir
    // getRegularTasks) — sinon inchangé.
    const progress = computeProgress(getRegularTasks(program), programEntry.assignedAt, program.endDate, submissions);

    res.json({
      programTitle: program.title,
      brandColor: program.brandColor || "",
      missionValidationThreshold: program.missionValidationThreshold,
      missionStatus: programEntry.statut,
      // Bannière de clôture + verrouillage des soumissions côté
      // ProgramProgress.jsx (décision utilisateur, 2026-08-19) —
      // finalReportReopened = seule la tâche isFinalReport reste
      // soumissible malgré missionClosed (voir submitTask/reviewSubmission).
      missionClosed: isVolunteerMissionClosed(programEntry),
      finalReportReopened: !!programEntry.finalReportReopenedAt,
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

    // Groupe + superviseur affecté, affichés devant chaque soumission (même
    // besoin que dans la progression par volontaire, décision utilisateur
    // 2026-08-18).
    const { groupNamesByVolunteerId, supervisorNamesByVolunteerId } = volunteerIds.length > 0
      ? await resolveGroupAndSupervisorNames(programId, volunteerIds)
      : { groupNamesByVolunteerId: new Map(), supervisorNamesByVolunteerId: new Map() };

    // Qui a validé/rejeté chaque soumission — staff uniquement, jamais
    // exposé au volontaire (getMyProgramProgress ne renvoie pas reviewedBy).
    const reviewerIds = [...new Set(submissions.filter((s) => s.reviewedBy).map((s) => String(s.reviewedBy)))];
    const User = getUserModel();
    const reviewers = reviewerIds.length > 0 ? await User.find({ _id: { $in: reviewerIds } }).select("name") : [];
    const reviewerNameById = new Map(reviewers.map((r) => [String(r._id), r.name]));

    const items = submissions.map((s) => {
      const volunteer = volunteerById.get(String(s.volunteerId));
      const task = taskById.get(s.taskId);
      return {
        ...s,
        volunteerName: volunteer ? `${volunteer.prenom} ${volunteer.nom}` : "Volontaire introuvable",
        volunteerEmail: volunteer?.email || "",
        groupNames: groupNamesByVolunteerId.get(String(s.volunteerId)) || [],
        supervisorNames: supervisorNamesByVolunteerId.get(String(s.volunteerId)) || [],
        taskTitle: task?.title || "Tâche supprimée",
        taskPublishedAt: task?.publishedAt || null,
        taskDueAt: task?.dueAt || null,
        // Filtre l'onglet "Rapports" côté staff (décision utilisateur,
        // 2026-08-19) — jamais recalculé côté client, la tâche a pu être
        // supprimée depuis (false dans ce cas, cohérent avec taskTitle
        // ci-dessus).
        isFinalReport: task?.isFinalReport || false,
        reviewerName: s.reviewedBy ? (reviewerNameById.get(String(s.reviewedBy)) || "Compte supprimé") : "",
        // Priorité à la copie figée au moment de la soumission (voir
        // models/volunteerTaskSubmission.js#proofFieldsSnapshot) — fiable
        // même si la tâche a changé/disparu depuis. Repli sur la définition
        // actuelle uniquement pour les soumissions faites avant l'ajout de
        // ce champ (best-effort, peut ne plus correspondre exactement).
        proofFields: s.proofFieldsSnapshot?.length > 0
          ? s.proofFieldsSnapshot
          : task ? getEffectiveProofFields(task) : DEFAULT_PROOF_FIELDS,
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

    const task = (program.tasks || []).find((t) => t.id === submission.taskId);

    // Volontaire concerné — chargé ici (pas seulement pour l'autorisation)
    // car nécessaire pour vérifier la clôture de mission ET, en cas
    // d'approbation du rapport final, pour la clôturer immédiatement.
    const volunteer = await Volunteer.findById(submission.volunteerId);
    if (!volunteer) return res.status(404).json({ message: "Volontaire introuvable" });
    const programEntry = volunteer.programs.find((p) => p.programId.toString() === submission.programId.toString());
    if (!programEntry) return res.status(404).json({ message: "Ce volontaire n'est plus rattaché à ce programme" });

    // Mission déjà clôturée pour ce volontaire — même verrou que
    // submitTask, même bypass pour un rapport final réactivé (décision
    // utilisateur, 2026-08-19 : "même pas un superviseur ne peut plus
    // rejeter ni valider une tâche ou rapport final").
    const finalReportReopened = task?.isFinalReport && !!programEntry.finalReportReopenedAt;
    if (isVolunteerMissionClosed(programEntry) && !finalReportReopened) {
      return res.status(409).json({ message: "La mission de ce volontaire sur ce programme est déjà terminée" });
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

    // Pas de promotion automatique en direct pour une tâche NORMALE — le
    // statut mission (validée/refusée) ne se décide qu'au moment où le
    // staff clique sur "Terminer les missions" (voir
    // exports.finalizeMissions), qui évalue tous les volontaires du
    // programme d'un coup. SEULE exception, décision utilisateur
    // 2026-08-19 : approuver LE rapport de fin de mission clôture
    // immédiatement la mission de CE volontaire, sans attendre — c'est
    // par construction son dernier jalon. Toujours réécrit (même si déjà
    // "Mission validée"/"Refusé") : contrairement au balayage automatique
    // de finalizeMissions, c'est une action manuelle explicite du staff
    // (utile notamment après une réactivation ciblée).
    if (newStatus === "APPROVED" && task?.isFinalReport) {
      programEntry.statut = "Mission validée";
      programEntry.finalReportReopenedAt = null;
      await volunteer.save();
    }

    res.json({ message: newStatus === "APPROVED" ? "Tâche approuvée" : "Tâche rejetée" });
  } catch (error) {
    next(error);
  }
}

exports.approveSubmission = (req, res, next) => reviewSubmission(req, res, next, "APPROVED");
exports.rejectSubmission = (req, res, next) => reviewSubmission(req, res, next, "REJECTED");

/* -------------------- Interne : groupe(s)/superviseur(s) d'un volontaire sur CE programme -------------------- */
/* Résout deux informations utiles au staff dans le suivi des tâches
   (décision utilisateur, 2026-08-18 : "pour chaque volontaire, on voit
   devant lui son groupe pour le programme et le superviseur auquel il est
   affecté") :
   - le(s) nom(s) de groupe — VolunteerApplicationGroup référence des
     candidatures, jamais des volontaires directement, donc il faut
     d'abord retrouver la candidature de CE volontaire sur CE programme
     (VolunteerApplication.volunteerId, rempli à l'acceptation) ;
   - le(s) nom(s) du/des superviseur(s) auquel il est affecté
     (GestionAmpUser.supervisedAssignments, programme par programme).
   Un volontaire peut en théorie appartenir à plusieurs groupes ou être
   affecté à plusieurs superviseurs — les deux Maps renvoient des tableaux
   (souvent à un seul élément en pratique). */
async function resolveGroupAndSupervisorNames(programId, volunteerIds) {
  const Application = getVolunteerApplicationModel();
  const applications = await Application.find({ programId, volunteerId: { $in: volunteerIds } }).select("volunteerId");
  const applicationIdByVolunteerId = new Map(applications.map((a) => [String(a.volunteerId), String(a._id)]));

  const Group = getVolunteerApplicationGroupModel();
  const groups = await Group.find({ programId }).select("name applicationIds");
  const groupNamesByApplicationId = new Map();
  groups.forEach((g) => {
    g.applicationIds.forEach((appId) => {
      const key = String(appId);
      if (!groupNamesByApplicationId.has(key)) groupNamesByApplicationId.set(key, []);
      groupNamesByApplicationId.get(key).push(g.name);
    });
  });
  const groupNamesByVolunteerId = new Map();
  volunteerIds.forEach((vid) => {
    const appId = applicationIdByVolunteerId.get(String(vid));
    groupNamesByVolunteerId.set(String(vid), appId ? (groupNamesByApplicationId.get(appId) || []) : []);
  });

  const User = getUserModel();
  const supervisors = await User.find({ role: "SUPERVISEUR", "supervisedAssignments.programId": programId })
    .select("name supervisedAssignments");
  const supervisorNamesByVolunteerId = new Map();
  supervisors.forEach((sup) => {
    const assignment = (sup.supervisedAssignments || []).find((a) => String(a.programId) === String(programId));
    (assignment?.volunteerIds || []).forEach((vid) => {
      const key = String(vid);
      if (!supervisorNamesByVolunteerId.has(key)) supervisorNamesByVolunteerId.set(key, []);
      supervisorNamesByVolunteerId.get(key).push(sup.name);
    });
  });

  return { groupNamesByVolunteerId, supervisorNamesByVolunteerId };
}

/* -------------------- Staff : progression de tous les volontaires d'un programme -------------------- */
exports.listProgramProgress = async (req, res, next) => {
  try {
    const { programId } = req.params;
    await resolveScheduledTasks();
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title tasks missionValidationThreshold endDate reviewerIds editorIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    // Le rapport de fin de mission ne compte jamais dans le % (voir
    // getRegularTasks).
    const regularTasks = getRegularTasks(program);

    const volunteerQuery = { "programs.programId": programId };

    if (!canReviewProgram(program, req.user)) {
      const assignment = await getSupervisorAssignment(req.user, program._id);
      if (!assignment) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter ce programme" });
      }
      volunteerQuery._id = { $in: assignment.volunteerIds };
    }

    // telephone ajouté (en plus de nom/prenom/email) — un SUPERVISEUR a
    // besoin des coordonnées complètes des volontaires qui lui sont
    // affectés, pas seulement de leur email (décision utilisateur,
    // 2026-08-17 : "il faut que le superviseur ait les informations
    // nécessaires des volontaires qui sont sur lui").
    const volunteers = await Volunteer.find(volunteerQuery).select("nom prenom email telephone programs");

    const Submission = getVolunteerTaskSubmissionModel();
    const allSubmissions = await Submission.find({ programId }).lean();
    const submissionsByVolunteer = new Map();
    allSubmissions.forEach((s) => {
      const key = String(s.volunteerId);
      if (!submissionsByVolunteer.has(key)) submissionsByVolunteer.set(key, []);
      submissionsByVolunteer.get(key).push(s);
    });

    const { groupNamesByVolunteerId, supervisorNamesByVolunteerId } =
      await resolveGroupAndSupervisorNames(programId, volunteers.map((v) => v._id));

    const items = volunteers.map((v) => {
      const programEntry = v.programs.find((p) => p.programId.toString() === programId);
      const submissions = submissionsByVolunteer.get(String(v._id)) || [];
      const progress = computeProgress(regularTasks, programEntry.assignedAt, program.endDate, submissions);
      return {
        volunteerId: v._id,
        nom: v.nom,
        prenom: v.prenom,
        email: v.email,
        telephone: v.telephone || "",
        groupNames: groupNamesByVolunteerId.get(String(v._id)) || [],
        supervisorNames: supervisorNamesByVolunteerId.get(String(v._id)) || [],
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
      .select("tasks endDate missionValidationThreshold missionsFinalizedAt reviewerIds editorIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }
    if (program.missionsFinalizedAt) {
      return res.status(409).json({ message: "Les missions de ce programme ont déjà été terminées" });
    }

    // Bloqué tant que la date limite du rapport de fin de mission (si
    // définie) n'est pas dépassée (décision utilisateur, 2026-08-19) —
    // évite de clore/refuser en masse des volontaires qui ont encore le
    // temps de soumettre leur rapport. Pas de dueAt sur cette tâche = pas
    // de porte (comportement inchangé).
    const finalReportTask = getPublishedTasks(program).find((t) => t.isFinalReport);
    if (finalReportTask?.dueAt && new Date(finalReportTask.dueAt) > new Date()) {
      return res.status(409).json({ message: "Le délai de soumission du rapport final n'est pas encore passé" });
    }

    // Le rapport de fin de mission ne compte jamais dans le % (voir
    // getRegularTasks).
    const regularTasks = getRegularTasks(program);
    if (regularTasks.length === 0) {
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
      const { percent } = computeProgress(regularTasks, programEntry.assignedAt, program.endDate, submissions);

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

/* -------------------- Staff : note interne sur une soumission -------------------- */
/* Outil de traitement du rapport de fin de mission (décision utilisateur,
   2026-08-19) — distinct de reviewNote (motif de rejet, visible du
   volontaire) : jamais exposé côté "Mon espace" (voir
   getMyProgramProgress, qui ne le renvoie pas). Modifiable quel que soit
   le statut de la soumission (pas de garde "déjà traité", contrairement à
   reviewSubmission) — une note de suivi n'a pas besoin d'attendre. */
exports.setSubmissionInternalNote = async (req, res, next) => {
  try {
    const Submission = getVolunteerTaskSubmissionModel();
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: "Soumission introuvable" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(submission.programId);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!(await canSuperviseVolunteer(program, submission.volunteerId, req.user))) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à annoter cette soumission" });
    }

    submission.internalNote = (req.body?.internalNote || "").toString();
    await submission.save();

    res.json({ message: "Note enregistrée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : réactiver le rapport final pour certains volontaires -------------------- */
/* Cas spécial explicitement demandé (2026-08-19) : "même si la mission est
   marquée terminée, on peut réactiver la même tâche rapport final à
   certains volontaires (soit à tout un groupe ou à un seul volontaire)".
   Ne touche QUE programEntry.finalReportReopenedAt — jamais le statut lui-
   même (repositionné seulement par une nouvelle approbation, voir
   reviewSubmission) et jamais les autres tâches (qui restent verrouillées
   pour ce volontaire tant que sa mission est clôturée). Autorisation
   canReviewProgram — jamais les superviseurs, comme "Terminer les
   missions" : action de gestion de programme. */
exports.reactivateFinalReport = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const { volunteerIds, groupId } = req.body || {};

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("tasks reviewerIds editorIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const finalReportTask = (program.tasks || []).find((t) => t.isFinalReport);
    if (!finalReportTask) {
      return res.status(400).json({ message: "Ce programme n'a pas de tâche \"rapport de fin de mission\"" });
    }

    // Résout le groupe → candidatures ACCEPTED → volontaires, même logique
    // que resolveGroupAndSupervisorNames (l'inverse : ici on part du
    // groupe pour retrouver ses volontaires, pas l'inverse).
    const targetIds = new Set((Array.isArray(volunteerIds) ? volunteerIds : []).map(String));
    if (groupId) {
      const Group = getVolunteerApplicationGroupModel();
      const group = await Group.findOne({ _id: groupId, programId }).select("applicationIds");
      if (!group) return res.status(404).json({ message: "Groupe introuvable" });
      const Application = getVolunteerApplicationModel();
      const applications = await Application.find({ _id: { $in: group.applicationIds } }).select("volunteerId");
      applications.forEach((a) => { if (a.volunteerId) targetIds.add(String(a.volunteerId)); });
    }

    if (targetIds.size === 0) {
      return res.status(400).json({ message: "Aucun volontaire ciblé" });
    }

    const volunteers = await Volunteer.find({ _id: { $in: [...targetIds] }, "programs.programId": programId });

    let reactivated = 0;
    for (const volunteer of volunteers) {
      const programEntry = volunteer.programs.find((p) => p.programId.toString() === programId);
      if (!programEntry) continue;
      programEntry.finalReportReopenedAt = new Date();
      await volunteer.save();
      reactivated += 1;
    }

    res.json({ reactivated });
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
    // description/location/startDate/endDate ajoutés pour que
    // SupervisorDashboard.jsx puisse afficher des infos sur le programme
    // (un superviseur n'a pas accès à GET /api/volunteer-programs/:id,
    // réservé ADMIN/EDITOR — cette route reste donc la seule source pour lui).
    const programs = await Program.find({ _id: { $in: assignments.map((a) => a.programId) } })
      .select("title description location startDate endDate");

    const items = programs.map((p) => {
      const assignment = assignments.find((a) => a.programId.toString() === p._id.toString());
      return {
        programId: p._id, title: p.title, volunteerCount: assignment?.volunteerIds?.length || 0,
        description: p.description, location: p.location, startDate: p.startDate, endDate: p.endDate,
      };
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

// Réutilisés par controllers/volunteerProgramPartnerController.js.
exports.getEffectiveProofFields = getEffectiveProofFields;
exports.DEFAULT_PROOF_FIELDS = DEFAULT_PROOF_FIELDS;
// Réutilisé par controllers/volunteerDisciplineController.js pour scoper
// les signalements d'un SUPERVISEUR à ses volontaires affectés, exactement
// comme le suivi de tâches.
exports.getSupervisorAssignment = getSupervisorAssignment;
