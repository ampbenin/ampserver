/**
 * Contrôleur Candidatures de recrutement — AMP Bénin
 * Mirror simplifié de volunteerApplicationController.js, adapté au pipeline
 * à 3 étapes des offres JobPosting (décision utilisateur, 2026-09-15) :
 * RECEIVED → UNDER_REVIEW → RETAINED/REJECTED. Pas d'accessMode OPEN
 * (aucune admission automatique pour une offre d'emploi), pas de
 * groupes/bulk (non demandés).
 *
 * Autorisation staff : ADMIN/EDITOR en bloc, comme routes/cms/jobs.js —
 * JobPosting n'a pas de notion d'affectation par utilisateur (contrairement
 * à VolunteerProgram/canReviewProgram), donc pas de vérification par offre.
 */

const getJobPostingModel = require("../models/cms/JobPosting");
const getJobApplicationModel = require("../models/jobApplication");
const getPersonnelModel = require("../models/personnel");
const resend = require("../utils/resendMailer");
const { renderBrandedEmail, escapeHtml } = require("../utils/emailTemplates");
const { validateApplicationResponses } = require("../utils/applicationFormLogic");

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

/* -------------------- Staff : lister les candidatures d'une offre -------------------- */
exports.listApplications = async (req, res, next) => {
  try {
    const { jobPostingId, status, search } = req.query;
    if (!jobPostingId) return res.status(400).json({ message: "jobPostingId requis" });

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

    application.staffNotes = req.body?.staffNotes || "";
    await application.save();
    res.json({ message: "Note enregistrée", item: application });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : retenir une candidature (→ Personnel) -------------------- */
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

    const JobPosting = getJobPostingModel();
    const job = await JobPosting.findById(application.jobPostingId);

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
        createdBy: req.user.id,
      });
    } else {
      personnel.category = category.trim();
      if (notes) personnel.notes = notes;
      await personnel.save();
    }

    application.status = "RETAINED";
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    application.personnelId = personnel._id;
    await application.save();

    await sendRetainedEmail(application, job);
    res.json({ message: "Candidature retenue, ajoutée au personnel", item: application, personnel });
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

/* -------------------- Staff : supprimer une candidature -------------------- */
exports.deleteApplication = async (req, res, next) => {
  try {
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
