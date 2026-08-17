/**
 * Contrôleur "Compte partenaire" — Programmes de volontariat AMP Bénin
 * Lecture seule des statistiques/impact/résultats d'un ou plusieurs
 * programmes suivis (GestionAmpUser.partnerProgramIds), jamais les tâches
 * rejetées/en attente — uniquement les volontaires à "Mission validée" et
 * leurs tâches APPROUVÉES. Les partenaires peuvent aussi poster un
 * commentaire, visible seulement par ADMIN/EDITOR (voir listPartnerComments).
 */

const mongoose = require("mongoose");
const streamifier = require("streamifier");
const { buildPartnerImpactReportPdf } = require("../utils/partnerReportPdf");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const getSiteSettingsModel = require("../models/siteSettings");
const getVolunteerTaskSubmissionModel = require("../models/volunteerTaskSubmission");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getVolunteerProgramPartnerCommentModel = require("../models/volunteerProgramPartnerComment");
const getPartnerActivityLogModel = require("../models/partnerActivityLog");
const getUserModel = require("../models/gestionamp/User");
const Volunteer = require("../models/volunteer");
const cloudinary = require("../utils/cloudinary");
const { computeProgress } = require("../utils/volunteerTaskLogic");
const { getEffectiveProofFields, getPublishedTasks, resolveScheduledTasks } = require("./volunteerTaskController");
const { buildApplicationFilterQuery, parsePagination } = require("./volunteerApplicationController");
const { logPartnerActivity } = require("../utils/partnerActivityLogger");

// Candidatures visibles par un partenaire : jamais les rejetées (contiennent
// les coordonnées de personnes non retenues, décision confirmée avec
// l'utilisateur) — seulement en attente + acceptées.
const PARTNER_VISIBLE_STATUSES = ["PENDING", "ACCEPTED"];

/* -------------------- Interne : vérifie que ce partenaire suit bien ce programme -------------------- */
async function assertPartnerAccess(userId, programId) {
  const User = getUserModel();
  const partner = await User.findById(userId).select("partnerProgramIds");
  return (partner?.partnerProgramIds || []).some((id) => id.toString() === programId.toString());
}
// Réutilisé par controllers/volunteerDisciplineController.js pour scoper
// les signalements d'un PARTENAIRE aux programmes qu'il suit.
exports.assertPartnerAccess = assertPartnerAccess;

/* -------------------- Protégé (PARTENAIRE) : programmes suivis -------------------- */
exports.listMyPartnerPrograms = async (req, res, next) => {
  try {
    const User = getUserModel();
    const partner = await User.findById(req.user.id).select("partnerProgramIds");
    const Program = getVolunteerProgramModel();
    const programs = await Program.find({ _id: { $in: partner?.partnerProgramIds || [] } })
      .select("title location startDate endDate status");

    // Appelé une seule fois au montage du dashboard (voir PartnerDashboard.jsx) —
    // meilleur proxy disponible pour "une session vient de s'ouvrir".
    await logPartnerActivity({ partnerId: req.user.id, action: "OPEN_DASHBOARD" });

    res.json({ items: programs });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Interne : calcule stats/volontaires validés/progression -------------------- */
/* Extrait de getPartnerProgramStats pour être réutilisé tel quel par
   downloadImpactReport — le PDF doit refléter EXACTEMENT les mêmes chiffres
   que le tableau de bord, pas un calcul parallèle qui pourrait diverger. */
async function computeProgramSnapshot(programId) {
  await resolveScheduledTasks();
  const Program = getVolunteerProgramModel();
  const program = await Program.findById(programId)
    .select("title description location startDate endDate tasks missionValidationThreshold applicationForm partnersBarImageUrl");
  if (!program) return null;
  const publishedTasks = getPublishedTasks(program);

  const volunteers = await Volunteer.find({ "programs.programId": programId }).select("nom prenom programs");
  const Submission = getVolunteerTaskSubmissionModel();
  const allSubmissions = await Submission.find({ programId }).lean();

  // Progression dans le temps (graphique du dashboard partenaire) : nombre
  // de tâches approuvées par mois, groupé sur reviewedAt (date de validation
  // par le staff/superviseur) — reflète le rythme réel d'activité plutôt que
  // la date d'échéance de la tâche.
  const progressOverTimeRaw = await Submission.aggregate([
    { $match: { programId: new mongoose.Types.ObjectId(programId), status: "APPROVED", reviewedAt: { $ne: null } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$reviewedAt" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const progressOverTime = progressOverTimeRaw.map((r) => ({ label: r._id, count: r.count }));

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
    const progress = computeProgress(publishedTasks, programEntry.assignedAt, program.endDate, submissions);
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
      // `progress` ajouté pour permettre au partenaire de classer ses
      // volontaires validés par progression (décision utilisateur,
      // 2026-08-17) — jusqu'ici seul `approvedTasks` était renvoyé.
      validatedVolunteers.push({ volunteerId: v._id, nom: v.nom, prenom: v.prenom, progress, approvedTasks });
    }
  }

  return {
    program,
    stats: {
      totalVolunteers: volunteers.length,
      validatedVolunteers: validatedCount,
      percentValidated: volunteers.length > 0 ? Math.round((validatedCount / volunteers.length) * 100) : 0,
      averageProgress: volunteers.length > 0 ? Math.round(percentSum / volunteers.length) : 0,
      totalApprovedTasks: totalApproved,
    },
    validatedVolunteers,
    progressOverTime,
  };
}

/* -------------------- Protégé (PARTENAIRE) : statistiques/impact/résultats d'un programme -------------------- */
exports.getPartnerProgramStats = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const snapshot = await computeProgramSnapshot(programId);
    if (!snapshot) return res.status(404).json({ message: "Programme introuvable" });

    await logPartnerActivity({ partnerId: req.user.id, programId, action: "VIEW_STATS" });

    res.json({
      program: {
        title: snapshot.program.title, description: snapshot.program.description, location: snapshot.program.location,
        startDate: snapshot.program.startDate, endDate: snapshot.program.endDate,
        applicationFormFields: snapshot.program.applicationForm?.fields || [],
        // Propre à CE programme (voir models/volunteerProgram.js) — jamais
        // un réglage global, seuls les partenaires qui suivent CE
        // programme la verront.
        partnersBarImageUrl: snapshot.program.partnersBarImageUrl || null,
      },
      stats: snapshot.stats,
      validatedVolunteers: snapshot.validatedVolunteers,
      progressOverTime: snapshot.progressOverTime,
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : candidatures du programme, lecture seule -------------------- */
/* Même pagination/recherche/filtres que la liste staff
   (volunteerApplicationController.js#listApplications, logique de filtre
   partagée via buildApplicationFilterQuery) mais volontairement restreinte
   à PARTNER_VISIBLE_STATUSES (jamais les rejetées) et sans aucune action
   (pas de accept/reject/delete/bulk/groupes exposés dans ce contrôleur —
   lecture seule par construction, pas seulement par absence de bouton
   côté frontend). */
exports.listPartnerApplications = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const { search, dateFrom, dateTo, fieldFilters, status } = req.query;

    let filterQuery;
    try {
      filterQuery = buildApplicationFilterQuery({ search, dateFrom, dateTo, fieldFilters });
    } catch {
      return res.status(400).json({ message: "fieldFilters invalide (JSON attendu)" });
    }

    // Le partenaire peut restreindre entre PENDING/ACCEPTED (case "Statut"
    // du panneau de filtre), jamais élargir au-delà de ce que
    // PARTNER_VISIBLE_STATUSES autorise, même si un statut arbitraire est
    // envoyé côté requête.
    const allowedStatuses = status && PARTNER_VISIBLE_STATUSES.includes(status) ? [status] : PARTNER_VISIBLE_STATUSES;

    const query = { ...filterQuery, programId, status: { $in: allowedStatuses } };

    const Application = getVolunteerApplicationModel();
    const { page, limit } = parsePagination(req.query);

    const [items, total] = await Promise.all([
      Application.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Application.countDocuments(query),
    ]);

    // Le plus direct des signaux "qu'est-ce qu'il aime vérifier" — quels
    // filtres/recherches un partenaire utilise réellement sur les candidatures.
    await logPartnerActivity({
      partnerId: req.user.id,
      programId,
      action: "VIEW_APPLICATIONS",
      metadata: { search: search || null, status: status || null, dateFrom: dateFrom || null, dateTo: dateTo || null, hasFieldFilters: !!fieldFilters },
    });

    res.json({ items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : upload de son logo (co-branding du dashboard) -------------------- */
exports.uploadPartnerLogo = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

    const uploaded = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "ong-site/partner-logos", resource_type: "image" },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    const User = getUserModel();
    await User.findByIdAndUpdate(req.user.id, { partnerLogoUrl: uploaded.secure_url });

    await logPartnerActivity({ partnerId: req.user.id, action: "UPLOAD_LOGO" });

    res.status(201).json({ url: uploaded.secure_url });
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

    await logPartnerActivity({ partnerId: req.user.id, programId, action: "POST_COMMENT" });

    res.status(201).json({ message: "Commentaire envoyé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : historique de mes propres commentaires (+ réponses de l'équipe) -------------------- */
exports.listMyComments = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Comment = getVolunteerProgramPartnerCommentModel();
    const comments = await Comment.find({ programId, partnerId: req.user.id }).sort({ createdAt: -1 });

    const items = comments.map((c) => ({
      _id: c._id,
      text: c.text,
      createdAt: c.createdAt,
      reply: c.reply,
      repliedAt: c.repliedAt,
    }));

    res.json({ items });
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
      reply: c.reply,
      repliedAt: c.repliedAt,
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR uniquement) : répondre à un commentaire partenaire -------------------- */
exports.replyToComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const reply = req.body?.reply?.trim() || "";
    if (!reply) {
      return res.status(400).json({ message: "La réponse ne peut pas être vide" });
    }

    const Comment = getVolunteerProgramPartnerCommentModel();
    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Commentaire introuvable" });

    comment.reply = reply;
    comment.repliedAt = new Date();
    comment.repliedBy = req.user.id;
    await comment.save();

    res.json({ message: "Réponse envoyée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : rapport d'impact PDF, généré à la demande -------------------- */
/* Reprend TOUT ce que le partenaire voit sur son tableau de bord (voir
   src/components/gestionamp/dashboard/partenaire/PartnerDashboard.jsx) :
   chiffres clés, progression dans le temps, liste des bénéficiaires (jamais
   les rejetées, même restriction que listPartnerApplications — visible
   dans le PDF seulement si demandé, voir includeBeneficiaries/
   onlyBeneficiaries ci-dessous), volontaires à mission validée + détail de
   leurs tâches approuvées, aperçu en images, et ses échanges avec l'équipe.
   La construction du PDF lui-même (mise en page, pagination, tableaux,
   mini bar chart, logos sur chaque page) vit dans utils/partnerReportPdf.js
   — ce contrôleur ne fait que rassembler les données, à l'identique de
   getPartnerProgramStats (même computeProgramSnapshot, pour ne jamais
   afficher des chiffres différents entre le tableau de bord et le PDF).

   Query params (ajoutés le 2026-08-07, décision utilisateur) :
   - includeBeneficiaries=true : inclut la liste des bénéficiaires dans le
     rapport complet (décochée par défaut côté frontend — absente sinon).
   - onlyBeneficiaries=true : ignore includeBeneficiaries et génère un PDF
     allégé contenant UNIQUEMENT le titre du programme + la liste des
     bénéficiaires (aucune autre section) — bouton de téléchargement dédié
     côté frontend, pas juste une variante de case à cocher. */
const MAX_APPLICATIONS_IN_REPORT = 300; // garde-fou : évite un PDF interminable sur un programme à très grand volume

exports.downloadImpactReport = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const onlyBeneficiaries = req.query.onlyBeneficiaries === "true";
    const includeBeneficiaries = onlyBeneficiaries || req.query.includeBeneficiaries === "true";

    // En mode "uniquement la liste", on évite le calcul complet des
    // statistiques/volontaires validés (inutile, non affiché) — seul le
    // titre du programme sert de contexte de page.
    const snapshot = onlyBeneficiaries ? null : await computeProgramSnapshot(programId);
    if (!onlyBeneficiaries && !snapshot) return res.status(404).json({ message: "Programme introuvable" });

    const Program = getVolunteerProgramModel();
    const programDoc = onlyBeneficiaries
      ? await Program.findById(programId).select("title description location startDate endDate partnersBarImageUrl")
      : snapshot.program;
    if (!programDoc) return res.status(404).json({ message: "Programme introuvable" });

    let applications = [];
    let applicationsTotal = 0;
    if (includeBeneficiaries) {
      const Application = getVolunteerApplicationModel();
      const applicationQuery = { programId, status: { $in: PARTNER_VISIBLE_STATUSES } };
      [applicationsTotal, applications] = await Promise.all([
        Application.countDocuments(applicationQuery),
        Application.find(applicationQuery)
          .select("applicantFirstName applicantLastName applicantEmail applicantPhone status createdAt")
          .sort({ createdAt: -1 })
          .limit(MAX_APPLICATIONS_IN_REPORT),
      ]);
    }

    let comments = [];
    if (!onlyBeneficiaries) {
      const Comment = getVolunteerProgramPartnerCommentModel();
      comments = await Comment.find({ programId, partnerId: req.user.id }).sort({ createdAt: -1 });
    }

    const User = getUserModel();
    const partner = await User.findById(req.user.id).select("name partnerLogoUrl");

    // ampLogoUrl reste un réglage global (marque AMP BENIN, identique pour
    // tous) — partnersBarImageUrl en revanche vient du PROGRAMME lui-même
    // (programDoc), jamais de SiteSettings : propre à chaque programme,
    // voir models/volunteerProgram.js#partnersBarImageUrl.
    const SiteSettings = getSiteSettingsModel();
    const settings = await SiteSettings.findOne();

    const pdfBytes = await buildPartnerImpactReportPdf({
      program: {
        title: programDoc.title,
        description: programDoc.description,
        location: programDoc.location,
        startDate: programDoc.startDate,
        endDate: programDoc.endDate,
      },
      partner: { name: partner?.name, partnerLogoUrl: partner?.partnerLogoUrl },
      ampLogoUrl: settings?.ampLogoUrl || null,
      partnersBarImageUrl: programDoc.partnersBarImageUrl || null,
      stats: snapshot?.stats,
      validatedVolunteers: snapshot?.validatedVolunteers,
      progressOverTime: snapshot?.progressOverTime,
      applications,
      applicationsTotal,
      comments: comments.map((c) => ({ text: c.text, createdAt: c.createdAt, reply: c.reply, repliedAt: c.repliedAt })),
      options: { includeBeneficiaries, onlyBeneficiaries },
    });

    const slug = programDoc.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const filenamePrefix = onlyBeneficiaries ? "liste-beneficiaires" : "rapport-impact";

    await logPartnerActivity({ partnerId: req.user.id, programId, action: "DOWNLOAD_REPORT" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filenamePrefix}-${slug || "programme"}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    next(error);
  }
};

/* ==================== Staff (ADMIN/EDITOR) : suivi d'activité des partenaires ==================== */
/* Pour savoir qui s'intéresse au programme et ce qu'il aime vérifier — voir
   utils/partnerActivityLogger.js pour les points d'instrumentation. */

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // "En ligne" si actif il y a moins de 5 min

/* -------------------- Staff : vue d'ensemble (tous partenaires, ou scopée à un programme) -------------------- */
exports.getPartnerActivitySummary = async (req, res, next) => {
  try {
    const { programId } = req.query;
    const User = getUserModel();

    const userQuery = { role: "PARTENAIRE" };
    if (programId) userQuery.partnerProgramIds = programId;
    const partners = await User.find(userQuery).select("name email partnerProgramIds");

    if (partners.length === 0) return res.json({ items: [] });

    const Log = getPartnerActivityLogModel();
    const partnerIds = partners.map((p) => p._id);
    // lastActiveAt/isOnline reflètent TOUJOURS l'activité du compte entière
    // (pas seulement ce programme) — "connecté" est une notion de compte,
    // pas de programme. Les compteurs d'actions, eux, sont scopés si programId fourni.
    const allLogs = await Log.find({ partnerId: { $in: partnerIds } })
      .select("partnerId programId action createdAt").sort({ createdAt: -1 }).lean();

    const Program = getVolunteerProgramModel();
    const allProgramIds = [...new Set(partners.flatMap((p) => (p.partnerProgramIds || []).map(String)))];
    const programs = await Program.find({ _id: { $in: allProgramIds } }).select("title");
    const programTitleById = new Map(programs.map((p) => [String(p._id), p.title]));

    const now = Date.now();
    const items = partners.map((partner) => {
      const ownLogs = allLogs.filter((l) => String(l.partnerId) === String(partner._id));
      const scopedLogs = programId ? ownLogs.filter((l) => String(l.programId) === String(programId)) : ownLogs;
      const lastActiveAt = ownLogs.length > 0 ? ownLogs[0].createdAt : null; // déjà trié desc
      const actionCounts = {};
      scopedLogs.forEach((l) => { actionCounts[l.action] = (actionCounts[l.action] || 0) + 1; });

      return {
        partnerId: partner._id,
        name: partner.name,
        email: partner.email,
        programs: (partner.partnerProgramIds || []).map((id) => programTitleById.get(String(id)) || "?"),
        lastActiveAt,
        isOnline: lastActiveAt ? now - new Date(lastActiveAt).getTime() < ONLINE_THRESHOLD_MS : false,
        totalActions: scopedLogs.length,
        actionCounts,
      };
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : historique détaillé d'un partenaire (drill-down) -------------------- */
exports.getPartnerActivityTimeline = async (req, res, next) => {
  try {
    const { partnerId } = req.params;
    const { programId } = req.query;

    const query = { partnerId };
    if (programId) query.programId = programId;

    const Log = getPartnerActivityLogModel();
    const { page, limit } = parsePagination(req.query, 20);

    const [logs, total] = await Promise.all([
      Log.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Log.countDocuments(query),
    ]);

    const Program = getVolunteerProgramModel();
    const programIds = [...new Set(logs.filter((l) => l.programId).map((l) => String(l.programId)))];
    const programs = programIds.length > 0 ? await Program.find({ _id: { $in: programIds } }).select("title") : [];
    const programTitleById = new Map(programs.map((p) => [String(p._id), p.title]));

    const items = logs.map((l) => ({
      _id: l._id,
      action: l.action,
      programTitle: l.programId ? programTitleById.get(String(l.programId)) || "?" : null,
      metadata: l.metadata,
      createdAt: l.createdAt,
    }));

    res.json({ items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    next(error);
  }
};
