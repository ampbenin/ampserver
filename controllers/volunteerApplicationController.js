/**
 * Contrôleur Candidatures de volontariat — AMP Bénin
 * Remplace/absorbe volunteerFormController.js. `programId` absent/nul =
 * candidature "spontanée" (aucun programme précis), validée contre le
 * modèle de formulaire marqué isSpontaneousDefault. Même logique
 * d'admission que NumSAL (controllers/numsal/courseController.js), adaptée
 * à l'absence de comptes utilisateurs côté volontaires : l'acceptation
 * crée/retrouve un profil Volunteer au lieu d'un compte de connexion.
 */

const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getVolunteerFormTemplateModel = require("../models/volunteerFormTemplate");
const Volunteer = require("../models/volunteer");
const resend = require("../utils/resendMailer");
const { renderBrandedEmail, renderContactBlockText, escapeHtml } = require("../utils/emailTemplates");
const { closeExpiredPrograms, canReviewProgram, DEFAULT_BUILTIN_FIELDS } = require("./volunteerProgramController");
const { validateApplicationResponses } = require("../utils/applicationFormLogic");

// Fixé en dur (pas de process.env.RESEND_FROM_EMAIL) : cette variable est
// partagée avec NumSAL (controllers/numsal/*.js) et réglée côté serveur sur
// son nom de marque — la lire ici affichait "NumSAL" comme expéditeur des
// emails de candidature volontaire AMP Bénin, au lieu du bon nom.
const RESEND_FROM = "VOLONTAIRE AMP BENIN <onboarding@resend.dev>";
const AMP_BRAND = {
  brandLabel: "AMP BÉNIN — Volontariat",
  footerText: "AMP BÉNIN — Programme de volontariat · Ceci est un message automatique.",
};

/* -------------------- Public : schéma du formulaire de candidature spontanée -------------------- */
/* Mirror de volunteerProgramController.getApplicationForm, mais pour le
   parcours "candidature spontanée" (sans programId) qui n'a pas de fiche
   VolunteerProgram propre — le formulaire vient du VolunteerFormTemplate
   marqué isSpontaneousDefault (peut être absent si aucun n'a encore été
   configuré : dans ce cas seuls les champs verrouillés sont proposés). */
exports.getSpontaneousForm = async (req, res, next) => {
  try {
    const FormTemplate = getVolunteerFormTemplateModel();
    const template = await FormTemplate.findOne({ isSpontaneousDefault: true });
    res.json({
      title: "Candidature spontanée",
      fields: [
        ...DEFAULT_BUILTIN_FIELDS,
        ...(template?.fields || []),
      ],
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : postuler (à un programme ou spontanément) -------------------- */
exports.applyToProgram = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const {
      programId, applicantFirstName, applicantLastName, applicantEmail, applicantPhone, responses,
    } = req.body;

    if (!applicantFirstName || !applicantLastName || !applicantEmail) {
      return res.status(400).json({ message: "Prénom, nom et email requis" });
    }

    let program = null;
    let fields = null;

    if (programId) {
      await closeExpiredPrograms();
      const Program = getVolunteerProgramModel();
      program = await Program.findById(programId);
      if (!program || program.status === "DRAFT" || program.status === "ARCHIVED") {
        return res.status(404).json({ message: "Programme introuvable" });
      }
      if (program.status === "CLOSED") {
        return res.status(400).json({ message: "Les candidatures pour ce programme sont closes (date limite dépassée)." });
      }
      fields = [
        ...DEFAULT_BUILTIN_FIELDS,
        ...(program.applicationForm?.fields || []).filter((f) => !f.locked),
      ];
    } else {
      const FormTemplate = getVolunteerFormTemplateModel();
      const spontaneousTemplate = await FormTemplate.findOne({ isSpontaneousDefault: true });
      fields = [
        ...DEFAULT_BUILTIN_FIELDS,
        ...(spontaneousTemplate?.fields || []),
      ];
    }

    const validationError = validateApplicationResponses(
      fields,
      { ...(responses || {}), applicantFirstName, applicantLastName, applicantEmail, applicantPhone }
    );
    if (validationError) return res.status(400).json({ message: validationError });

    const application = await Application.create({
      programId: program ? program._id : null,
      applicantFirstName,
      applicantLastName,
      applicantEmail,
      applicantPhone: applicantPhone || "",
      responses: responses || {},
    });

    if (program && program.accessMode === "OPEN") {
      // Accès ouvert = pas d'examen par le staff, admission immédiate.
      await finalizeAcceptance(application, program, null);
      return res.status(201).json({ message: "Inscription confirmée", id: application._id });
    }

    await sendReceivedEmail(application, program);
    res.status(201).json({ message: "Candidature envoyée avec succès", id: application._id });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Vous avez déjà postulé à ce programme" });
    }
    next(error);
  }
};

/* -------------------- Staff : lister les candidatures -------------------- */
/* Filtrable par programId (?programId=... ou ?programId=spontaneous) et
   status. Un reviewer non-ADMIN/EDITOR ne voit que les candidatures des
   programmes qui lui sont rattachés (pas les candidatures spontanées, qui
   nécessitent ADMIN/EDITOR). */
exports.listApplications = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const { programId, status } = req.query;
    const query = {};

    if (programId === "spontaneous") {
      query.programId = null;
      if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
        return res.status(403).json({ message: "Non autorisé" });
      }
    } else if (programId) {
      const Program = getVolunteerProgramModel();
      const program = await Program.findById(programId);
      if (!program) return res.status(404).json({ message: "Programme introuvable" });
      if (!canReviewProgram(program, req.user)) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter les candidatures de ce programme" });
      }
      query.programId = programId;
    } else if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
      return res.status(403).json({ message: "Non autorisé" });
    }

    if (status) query.status = status;

    const applications = await Application.find(query).sort({ createdAt: -1 });
    res.json({ items: applications });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : accepter une candidature -------------------- */
exports.acceptApplication = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });
    if (application.status !== "PENDING") {
      return res.status(409).json({ message: "Cette candidature a déjà été traitée" });
    }

    let program = null;
    if (application.programId) {
      const Program = getVolunteerProgramModel();
      program = await Program.findById(application.programId);
      if (!program) return res.status(404).json({ message: "Programme introuvable" });
      if (!canReviewProgram(program, req.user)) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à évaluer ce programme" });
      }
    } else if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
      return res.status(403).json({ message: "Non autorisé" });
    }

    await finalizeAcceptance(application, program, req.user.id);
    res.json({ message: "Candidature acceptée, email envoyé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : rejeter une candidature -------------------- */
exports.rejectApplication = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });
    if (application.status !== "PENDING") {
      return res.status(409).json({ message: "Cette candidature a déjà été traitée" });
    }

    if (application.programId) {
      const Program = getVolunteerProgramModel();
      const program = await Program.findById(application.programId);
      if (!program) return res.status(404).json({ message: "Programme introuvable" });
      if (!canReviewProgram(program, req.user)) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à évaluer ce programme" });
      }
    } else if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
      return res.status(403).json({ message: "Non autorisé" });
    }

    application.status = "REJECTED";
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    await application.save();

    res.json({ message: "Candidature rejetée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Interne : accepter une candidature -------------------- */
/* Trouve-ou-crée le profil Volunteer par email (remplace le bouton
   "Promouvoir" manuel de l'ancien système, qui n'agissait jamais en masse
   ni automatiquement), rattache le programme s'il y en a un, envoie l'email
   d'admission. `reviewerId` est null pour une admission automatique
   (programme en accès ouvert). */
async function finalizeAcceptance(application, program, reviewerId) {
  let volunteer = await Volunteer.findOne({ email: application.applicantEmail });
  if (!volunteer) {
    volunteer = await Volunteer.create({
      nom: application.applicantLastName,
      prenom: application.applicantFirstName,
      email: application.applicantEmail,
      telephone: application.applicantPhone || "",
    });
  }

  if (program) {
    const alreadyAssigned = volunteer.programs.some((p) => p.programId.toString() === program._id.toString());
    if (!alreadyAssigned) {
      volunteer.programs.push({ programId: program._id, statut: "Non disponible" });
      await volunteer.save();
    }
  }

  application.status = "ACCEPTED";
  application.reviewedBy = reviewerId;
  application.reviewedAt = new Date();
  application.volunteerId = volunteer._id;
  await application.save();

  await sendAcceptedEmail(application, program);
  return volunteer;
}

/* -------------------- Emails -------------------- */

const fullName = (application) => `${application.applicantFirstName} ${application.applicantLastName}`;

async function sendReceivedEmail(application, program) {
  const name = fullName(application);
  const label = program ? `au programme "${program.title}"` : "spontanée";
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: application.applicantEmail,
      subject: program ? `Candidature reçue — ${program.title}` : "Candidature spontanée reçue — AMP BÉNIN",
      text: [
        `Bonjour ${name},`,
        ``,
        `Nous avons bien reçu votre candidature ${label}.`,
        `Notre équipe va l'examiner et vous serez averti(e) par email si votre profil est retenu.`,
        ``,
        `Merci de votre intérêt pour le volontariat AMP BÉNIN !`,
        renderContactBlockText(program || {}),
      ].join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Candidature reçue",
        contactWhatsapp: program?.contactWhatsapp,
        contactEmail: program?.contactEmail,
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(name)},</p>`,
          `<p>Nous avons bien reçu votre candidature ${program ? `au programme <strong>${escapeHtml(program.title)}</strong>` : "spontanée"}.</p>`,
          `<p>Notre équipe va l'examiner et vous serez averti(e) par email si votre profil est retenu.</p>`,
          `<p>Merci de votre intérêt pour le volontariat AMP BÉNIN !</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email de réception de candidature volontaire:", mailError.message);
  }
}

async function sendAcceptedEmail(application, program) {
  const name = fullName(application);
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: application.applicantEmail,
      subject: program ? `Admission au programme "${program.title}" — AMP BÉNIN` : "Bienvenue chez les volontaires AMP BÉNIN",
      text: [
        `Bonjour ${name},`,
        ``,
        program
          ? `Félicitations, votre candidature au programme "${program.title}" a été retenue.`
          : `Merci pour votre engagement, votre profil rejoint notre fichier de volontaires.`,
        program?.admissionInstructions ? `\n${program.admissionInstructions}\n` : "",
        `Notre équipe pourra vous recontacter pour la suite.`,
        renderContactBlockText(program || {}),
      ].filter(Boolean).join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Candidature retenue 🎉",
        contactWhatsapp: program?.contactWhatsapp,
        contactEmail: program?.contactEmail,
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(name)},</p>`,
          `<p>${program
            ? `Félicitations, votre candidature au programme <strong>${escapeHtml(program.title)}</strong> a été retenue.`
            : `Merci pour votre engagement, votre profil rejoint notre fichier de volontaires.`}</p>`,
          program?.admissionInstructions
            ? `<p>${escapeHtml(program.admissionInstructions).replace(/\n/g, "<br>")}</p>`
            : "",
          `<p>Notre équipe pourra vous recontacter pour la suite.</p>`,
        ].filter(Boolean).join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email d'admission volontaire:", mailError.message);
  }
}
