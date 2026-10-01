/**
 * Contrôleur Candidatures de recrutement — AMP Bénin
 * Mirror simplifié de volunteerApplicationController.js, adapté au pipeline
 * à 3 étapes des offres JobPosting (décision utilisateur, 2026-09-15) :
 * RECEIVED → UNDER_REVIEW → RETAINED/REJECTED. Pas d'accessMode OPEN
 * (aucune admission automatique pour une offre d'emploi), pas de
 * groupes/bulk (non demandés).
 *
 * Autorisation staff : par offre, via JobPosting.staffAccess (décision
 * utilisateur, 2026-09-30 — voir controllers/cms/jobPostingsController.js#getJobAccess,
 * même esprit que canReviewProgram pour le volontariat mais plus
 * granulaire) : canViewApplications pour lister, canReviewApplications pour
 * faire avancer le pipeline (review/retain/reject), suppression toujours
 * réservée à ADMIN (jamais délégable).
 */

const getJobPostingModel = require("../models/cms/JobPosting");
const getJobApplicationModel = require("../models/jobApplication");
const getPersonnelModel = require("../models/personnel");
const resend = require("../utils/resendMailer");
const { renderBrandedEmail, escapeHtml } = require("../utils/emailTemplates");
const { validateApplicationResponses } = require("../utils/applicationFormLogic");
const cloudinary = require("../utils/cloudinary");
const streamifier = require("streamifier");
const { getJobAccess } = require("./cms/jobPostingsController");

const RESEND_FROM = "RECRUTEMENT AMP BENIN <candidatures@ampbenin.org>";
const AMP_BRAND = {
  brandLabel: "AMP BÉNIN — Recrutement",
  footerText: "AMP BÉNIN — Recrutement · Ceci est un message automatique.",
};

// Mêmes 4 champs verrouillés que le volontariat (voir
// controllers/volunteerProgramController.js#DEFAULT_BUILTIN_FIELDS) —
// dupliqués ici plutôt qu'importés : ce contrôleur ne dépend pas du système
// de volontariat (même choix que NumSAL, qui a sa propre copie).
const DEFAULT_BUILTIN_FIELDS = [
  {
    id: "applicantFirstName", label: "Quel est votre prénom ?", type: "TEXT",
    required: true, locked: true, options: [], validation: {}, conditional: { fieldId: "", values: [] },
  },
  {
    id: "applicantLastName", label: "Quel est votre nom ?", type: "TEXT",
    required: true, locked: true, options: [], validation: {}, conditional: { fieldId: "", values: [] },
  },
  {
    id: "applicantEmail", label: "Quelle est votre adresse email ?", type: "EMAIL",
    required: true, locked: true, options: [], validation: {}, conditional: { fieldId: "", values: [] },
  },
  {
    id: "applicantPhone", label: "Un numéro de téléphone pour vous joindre ?", type: "PHONE",
    required: false, locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] },
  },
];
exports.DEFAULT_BUILTIN_FIELDS = DEFAULT_BUILTIN_FIELDS;

const ensureBuiltinFields = (fields) => {
  const existingIds = new Set((fields || []).map((f) => f.id));
  const missing = DEFAULT_BUILTIN_FIELDS.filter((f) => !existingIds.has(f.id));
  return missing.length ? [...missing, ...(fields || [])] : fields || [];
};

/* -------------------- Public : schéma du formulaire de candidature -------------------- */
exports.getApplicationForm = async (req, res, next) => {
  try {
    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(req.params.jobPostingId);
    if (!job || job.status !== "PUBLISHED") {
      return res.status(404).json({ message: "Offre introuvable" });
    }

    res.json({
      title: job.title,
      estimatedDuration: job.applicationForm?.estimatedDuration || "",
      backgroundColor: job.applicationForm?.backgroundColor || "",
      textColor: job.applicationForm?.textColor || "",
      fields: ensureBuiltinFields(job.applicationForm?.fields),
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : postuler à une offre -------------------- */
exports.applyToJob = async (req, res, next) => {
  try {
    const { jobPostingId, applicantFirstName, applicantLastName, applicantEmail, applicantPhone, responses } = req.body;

    if (!jobPostingId) return res.status(400).json({ message: "jobPostingId requis" });
    if (!applicantFirstName || !applicantLastName || !applicantEmail) {
      return res.status(400).json({ message: "Prénom, nom et email requis" });
    }

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(jobPostingId);
    if (!job || job.status !== "PUBLISHED") {
      return res.status(404).json({ message: "Offre introuvable" });
    }

    const fields = ensureBuiltinFields(job.applicationForm?.fields);
    const validationError = validateApplicationResponses(
      fields,
      { ...(responses || {}), applicantFirstName, applicantLastName, applicantEmail, applicantPhone }
    );
    if (validationError) return res.status(400).json({ message: validationError });

    const Application = getJobApplicationModel();
    const application = await Application.create({
      jobPostingId: job._id,
      applicantFirstName,
      applicantLastName,
      applicantEmail,
      applicantPhone: applicantPhone || "",
      responses: responses || {},
    });

    await sendReceivedEmail(application, job);
    res.status(201).json({ message: "Candidature envoyée avec succès", id: application._id });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Vous avez déjà postulé à cette offre" });
    }
    next(error);
  }
};

/* -------------------- Public : upload d'une pièce jointe (champ FILE) -------------------- */
/* Même schéma que numsal/testimonialController.js#uploadPhoto (point d'entrée
   public sans compte, protégé par authLimiter sur la route + un plafond de
   taille au niveau multer) — resource_type "raw" (comme
   certificateController.js#uploadFromBuffer pour les PDF générés) plutôt que
   "auto" : "auto" fait interpréter/valider le fichier par Cloudinary (un PDF
   est alors traité comme une image potentiellement rasterisable et rejeté
   s'il n'est pas strictement conforme), alors qu'un champ FILE doit accepter
   tel quel n'importe quel document (CV en PDF/DOCX...), sans validation de
   contenu. La limite de taille/type propre à CE champ
   (validation.maxFileSizeMB/allowedFileTypes) est imposée côté client avant
   l'appel, comme maxImages pour les champs IMAGE ailleurs dans ce projet —
   pas revérifiée ici, même niveau de garantie que le reste de ce schéma. */
exports.uploadApplicationFile = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

    // `format` force Cloudinary à suffixer le public_id (donc secure_url)
    // avec l'extension d'origine (ex : CV.pdf) — sans ça, un upload "raw"
    // ne garde jamais l'extension et le fichier téléchargé arrive sans
    // ".pdf"/".docx", obligeant l'utilisateur à la rajouter à la main.
    // Nécessite que "Allow delivery of PDF and ZIP files" soit activé côté
    // Cloudinary (Settings → Security) — fait le 2026-10-01 par l'ONG, voir
    // aussi la restriction contournée différemment dans
    // certificateController.js#buildDownloadUrl avant cette activation.
    const originalName = req.file.originalname || "";
    const extension = originalName.includes(".")
      ? originalName.split(".").pop().toLowerCase()
      : undefined;

    const uploaded = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "recruitment/applications",
          resource_type: "raw",
          ...(extension && { format: extension }),
        },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    res.status(201).json({ url: uploaded.secure_url, fileName: req.file.originalname });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : lister les candidatures d'une offre -------------------- */
exports.listApplications = async (req, res, next) => {
  try {
    const { jobPostingId, status, search } = req.query;
    if (!jobPostingId) return res.status(400).json({ message: "jobPostingId requis" });

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(jobPostingId);
    if (!job) return res.status(404).json({ message: "Offre introuvable" });
    if (!getJobAccess(job, req.user).canViewApplications) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter les candidatures de cette offre" });
    }

    const query = { jobPostingId };
    if (status) query.status = status;

    if (search?.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { applicantFirstName: regex },
        { applicantLastName: regex },
        { applicantEmail: regex },
        { applicantPhone: regex },
      ];
    }

    const Application = getJobApplicationModel();
    const items = await Application.find(query).sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : passer une candidature "en étude" -------------------- */
exports.moveToReview = async (req, res, next) => {
  try {
    const Application = getJobApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(application.jobPostingId);
    if (!job || !getJobAccess(job, req.user).canReviewApplications) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à étudier les candidatures de cette offre" });
    }

    if (application.status !== "RECEIVED") {
      return res.status(409).json({ message: "Cette candidature n'est plus au statut \"Reçue\"" });
    }

    application.status = "UNDER_REVIEW";
    if (typeof req.body?.staffNotes === "string") application.staffNotes = req.body.staffNotes;
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    await application.save();

    res.json({ message: "Candidature passée en étude", item: application });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : mettre à jour la note interne -------------------- */
exports.updateNotes = async (req, res, next) => {
  try {
    const Application = getJobApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(application.jobPostingId);
    if (!job || !getJobAccess(job, req.user).canReviewApplications) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à étudier les candidatures de cette offre" });
    }

    application.staffNotes = req.body?.staffNotes || "";
    await application.save();
    res.json({ message: "Note enregistrée", item: application });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Interne : crée/relie le Personnel et finalise RETAINED -------------------- */
/* Partagé entre retainApplication (ADMIN, direct) et validateRetain (ADMIN,
   après proposition d'un non-ADMIN) — seul chemin qui crée réellement la
   fiche Personnel et envoie l'email, jamais à l'étape PENDING_VALIDATION. */
async function finalizeRetain(application, job, { category, notes }, adminId) {
  const Personnel = getPersonnelModel();
  let personnel = await Personnel.findOne({ email: application.applicantEmail });
  if (!personnel) {
    personnel = await Personnel.create({
      firstName: application.applicantFirstName,
      lastName: application.applicantLastName,
      email: application.applicantEmail,
      phone: application.applicantPhone || "",
      category: category.trim(),
      notes: notes || "",
      sourceJobPostingId: application.jobPostingId,
      sourceApplicationId: application._id,
      createdBy: adminId,
    });
  } else {
    personnel.category = category.trim();
    if (notes) personnel.notes = notes;
    await personnel.save();
  }

  application.status = "RETAINED";
  application.reviewedBy = adminId;
  application.reviewedAt = new Date();
  application.personnelId = personnel._id;
  await application.save();

  await sendRetainedEmail(application, job);
  return personnel;
}

/* -------------------- Staff : retenir une candidature -------------------- */
/* Un ADMIN retient directement (comportement inchangé : Personnel +
   RETAINED + email immédiats). Un non-ADMIN (affecté via staffAccess avec
   canReviewApplications — EDITOR/EC/IS/SUPERVISEUR/PARTENAIRE) ne fait que
   PROPOSER : la candidature passe à PENDING_VALIDATION, rien n'est envoyé
   ni créé tant qu'un ADMIN n'a pas validé (voir validateRetain) — décision
   utilisateur, 2026-09-30 : "il faut un ADMIN pour valider le traitement". */
exports.retainApplication = async (req, res, next) => {
  try {
    const { category, notes } = req.body;
    if (!category?.trim()) return res.status(400).json({ message: "Catégorie d'agent requise" });

    const Application = getJobApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });
    if (application.status === "RETAINED") {
      return res.status(409).json({ message: "Cette candidature est déjà retenue" });
    }
    if (application.status === "PENDING_VALIDATION") {
      return res.status(409).json({ message: "Cette candidature est déjà en attente de validation ADMIN" });
    }

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(application.jobPostingId);
    if (!job || !getJobAccess(job, req.user).canReviewApplications) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à étudier les candidatures de cette offre" });
    }

    if (req.user.role === "ADMIN") {
      const personnel = await finalizeRetain(application, job, { category, notes }, req.user.id);
      return res.json({ message: "Candidature retenue, ajoutée au personnel", item: application, personnel });
    }

    application.status = "PENDING_VALIDATION";
    application.proposedCategory = category.trim();
    application.proposedNotes = notes || "";
    application.proposedBy = req.user.id;
    application.proposedAt = new Date();
    await application.save();

    res.json({ message: "Rétention proposée — en attente de validation par un ADMIN", item: application });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : valider une proposition de rétention -------------------- */
/* category/notes optionnels dans le body pour permettre à l'ADMIN de
   corriger la proposition avant validation ; sinon reprend telle quelle
   la proposition du non-ADMIN. */
exports.validateRetain = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Seul un ADMIN peut valider une rétention" });
    }

    const Application = getJobApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });
    if (application.status !== "PENDING_VALIDATION") {
      return res.status(409).json({ message: "Cette candidature n'est pas en attente de validation" });
    }

    const category = req.body?.category?.trim() || application.proposedCategory;
    const notes = req.body?.notes ?? application.proposedNotes;
    if (!category) return res.status(400).json({ message: "Catégorie d'agent requise" });

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(application.jobPostingId);

    const personnel = await finalizeRetain(application, job, { category, notes }, req.user.id);
    res.json({ message: "Rétention validée, candidat ajouté au personnel", item: application, personnel });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : refuser une candidature -------------------- */
exports.rejectApplication = async (req, res, next) => {
  try {
    const Application = getJobApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(application.jobPostingId);
    if (!job || !getJobAccess(job, req.user).canReviewApplications) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à étudier les candidatures de cette offre" });
    }

    if (application.status === "RETAINED") {
      return res.status(409).json({ message: "Cette candidature est déjà retenue" });
    }

    application.status = "REJECTED";
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    await application.save();

    res.json({ message: "Candidature refusée", item: application });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : supprimer une candidature -------------------- */
/* Jamais délégable via staffAccess (décision utilisateur) — même une
   personne avec canReviewApplications ne peut pas supprimer. */
exports.deleteApplication = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Seul un ADMIN peut supprimer une candidature" });
    }
    const Application = getJobApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });

    await application.deleteOne();
    res.json({ message: "Candidature supprimée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Emails -------------------- */

const fullName = (application) => `${application.applicantFirstName} ${application.applicantLastName}`;

async function sendReceivedEmail(application, job) {
  const name = fullName(application);
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: application.applicantEmail,
      subject: `Candidature reçue — ${job.title}`,
      text: [
        `Bonjour ${name},`,
        ``,
        `Nous avons bien reçu votre candidature pour "${job.title}".`,
        `Notre équipe va l'examiner et vous serez averti(e) par email si votre profil est retenu.`,
        ``,
        `Merci de votre intérêt pour AMP BÉNIN !`,
      ].join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Candidature reçue",
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(name)},</p>`,
          `<p>Nous avons bien reçu votre candidature pour <strong>${escapeHtml(job.title)}</strong>.</p>`,
          `<p>Notre équipe va l'examiner et vous serez averti(e) par email si votre profil est retenu.</p>`,
          `<p>Merci de votre intérêt pour AMP BÉNIN !</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email de réception de candidature recrutement:", mailError.message);
  }
}

async function sendRetainedEmail(application, job) {
  const name = fullName(application);
  const jobLabel = job ? `pour "${job.title}"` : "";
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: application.applicantEmail,
      subject: `Candidature retenue ${jobLabel} — AMP BÉNIN`,
      text: [
        `Bonjour ${name},`,
        ``,
        `Félicitations, votre candidature ${jobLabel} a été retenue.`,
        `Notre équipe va vous recontacter pour la suite.`,
        ``,
        `Bienvenue chez AMP BÉNIN !`,
      ].join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Candidature retenue 🎉",
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(name)},</p>`,
          `<p>Félicitations, votre candidature ${jobLabel ? escapeHtml(jobLabel) : ""} a été retenue.</p>`,
          `<p>Notre équipe va vous recontacter pour la suite.</p>`,
          `<p>Bienvenue chez AMP BÉNIN !</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email d'admission recrutement:", mailError.message);
  }
}
