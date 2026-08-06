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
const { generateSetPasswordUrl } = require("./volunteerAuthController");

const FRONTEND_BASE = process.env.FRONTEND_URL || "https://ampbenin.netlify.app";

// Fixé en dur (pas de process.env.RESEND_FROM_EMAIL) : cette variable est
// partagée avec NumSAL (controllers/numsal/*.js) et réglée côté serveur sur
// son nom de marque — la lire ici affichait "NumSAL" comme expéditeur des
// emails de candidature volontaire AMP Bénin, au lieu du bon nom. L'adresse
// (candidatures@ampbenin.org) reste la même que RESEND_FROM_EMAIL — c'est
// un domaine vérifié Resend, PAS onboarding@resend.dev (sandbox restreinte
// à l'email du propriétaire du compte, d'où les emails qui n'arrivaient
// plus après un premier correctif trop rapide de ce nom d'expéditeur).
const RESEND_FROM = "VOLONTAIRE AMP BENIN <candidatures@ampbenin.org>";
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

/* -------------------- Interne : filtres partagés recherche/dates/formulaire -------------------- */
/* Réutilisé par listApplications (staff, tous statuts) ET
   volunteerProgramPartnerController.js#listPartnerApplications (partenaire,
   restreint à PENDING/ACCEPTED côté appelant) — même logique de filtre,
   deux périmètres d'autorisation et de statuts différents. Lève une erreur
   si fieldFilters n'est pas du JSON valide ; à l'appelant de répondre 400. */
function buildApplicationFilterQuery({ search, dateFrom, dateTo, fieldFilters }) {
  const query = {};

  // Recherche libre : scopée aux champs fixes (nom/email/téléphone) — les
  // réponses de formulaire passent par fieldFilters, pas par la recherche
  // (pas de wildcard simple sur une Map en Mongo).
  if (search?.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { applicantFirstName: regex },
      { applicantLastName: regex },
      { applicantEmail: regex },
      { applicantPhone: regex },
    ];
  }

  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(`${dateTo}T23:59:59.999`);
  }

  if (fieldFilters) {
    const parsed = JSON.parse(fieldFilters); // laisse throw si invalide
    Object.entries(parsed || {}).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || value === "") return;
      query[`responses.${fieldId}`] = value;
    });
  }

  return query;
}

function parsePagination(query, defaultLimit = 10) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit };
}

exports.buildApplicationFilterQuery = buildApplicationFilterQuery;
exports.parsePagination = parsePagination;

/* -------------------- Staff : lister les candidatures -------------------- */
/* Filtrable par programId (?programId=... ou ?programId=spontaneous), status,
   recherche libre (nom/email/téléphone), plage de dates de candidature et
   réponses de formulaire (SELECT/CHECKBOX) — paginé (page/limit, défaut
   1/10) pour rester jouable une fois qu'un programme dépasse quelques
   dizaines de candidatures. Un reviewer non-ADMIN/EDITOR ne voit que les
   candidatures des programmes qui lui sont rattachés (pas les candidatures
   spontanées, qui nécessitent ADMIN/EDITOR). */
exports.listApplications = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const { programId, status, search, dateFrom, dateTo, fieldFilters } = req.query;
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

    let filterQuery;
    try {
      filterQuery = buildApplicationFilterQuery({ search, dateFrom, dateTo, fieldFilters });
    } catch {
      return res.status(400).json({ message: "fieldFilters invalide (JSON attendu)" });
    }
    Object.assign(query, filterQuery);

    const { page, limit } = parsePagination(req.query);

    const [items, total] = await Promise.all([
      Application.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Application.countDocuments(query),
    ]);

    res.json({ items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (Mon espace) : mes candidatures -------------------- */
exports.listMyApplications = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const applications = await Application.find({ applicantEmail: req.user.email }).sort({ createdAt: -1 });

    // Résolution manuelle des titres de programme (VolunteerProgram vit sur
    // formDB, VolunteerApplication aussi en fait — mais on reste cohérent
    // avec le pattern déjà utilisé ailleurs dans ce contrôleur/volunteerController.js).
    const Program = getVolunteerProgramModel();
    const programIds = [...new Set(applications.map((a) => a.programId).filter(Boolean).map(String))];
    const programs = programIds.length > 0
      ? await Program.find({ _id: { $in: programIds } }).select("title")
      : [];
    const titleById = new Map(programs.map((p) => [String(p._id), p.title]));

    const items = applications.map((a) => {
      const obj = a.toObject();
      obj.programTitle = a.programId ? titleById.get(String(a.programId)) || null : null;
      return obj;
    });

    res.json({ items });
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

/* -------------------- Staff : supprimer une candidature -------------------- */
/* Utilisable quel que soit le statut (en attente, acceptée ou rejetée) —
   une candidature acceptée a déjà été copiée dans le profil Volunteer
   (voir finalizeAcceptance), donc la supprimer ici ne fait perdre aucune
   donnée sur le volontaire lui-même. Même règle d'autorisation
   qu'accept/reject. */
exports.deleteApplication = async (req, res, next) => {
  try {
    const Application = getVolunteerApplicationModel();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });

    if (application.programId) {
      const Program = getVolunteerProgramModel();
      const program = await Program.findById(application.programId);
      if (program && !canReviewProgram(program, req.user)) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer les candidatures de ce programme" });
      }
    } else if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
      return res.status(403).json({ message: "Non autorisé" });
    }

    await application.deleteOne();
    res.json({ message: "Candidature supprimée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : accepter plusieurs candidatures à la fois -------------------- */
/* Réutilise finalizeAcceptance (même logique/email que l'acceptation
   unitaire) — tolère les échecs individuels (déjà traitée, non autorisée...)
   sans faire échouer le reste du lot. */
exports.bulkAcceptApplications = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ message: "Aucune candidature sélectionnée" });

    const Application = getVolunteerApplicationModel();
    const Program = getVolunteerProgramModel();
    let accepted = 0;
    const failed = [];

    for (const id of ids) {
      try {
        const application = await Application.findById(id);
        if (!application) { failed.push({ id, message: "Candidature introuvable" }); continue; }
        if (application.status !== "PENDING") { failed.push({ id, message: "Déjà traitée" }); continue; }

        let program = null;
        if (application.programId) {
          program = await Program.findById(application.programId);
          if (!program) { failed.push({ id, message: "Programme introuvable" }); continue; }
          if (!canReviewProgram(program, req.user)) { failed.push({ id, message: "Non autorisé" }); continue; }
        } else if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
          failed.push({ id, message: "Non autorisé" });
          continue;
        }

        await finalizeAcceptance(application, program, req.user.id);
        accepted += 1;
      } catch (itemError) {
        failed.push({ id, message: itemError.message || "Erreur" });
      }
    }

    res.json({ accepted, failed });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : rejeter plusieurs candidatures à la fois -------------------- */
exports.bulkRejectApplications = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ message: "Aucune candidature sélectionnée" });

    const Application = getVolunteerApplicationModel();
    const Program = getVolunteerProgramModel();
    let rejected = 0;
    const failed = [];

    for (const id of ids) {
      try {
        const application = await Application.findById(id);
        if (!application) { failed.push({ id, message: "Candidature introuvable" }); continue; }
        if (application.status !== "PENDING") { failed.push({ id, message: "Déjà traitée" }); continue; }

        if (application.programId) {
          const program = await Program.findById(application.programId);
          if (!program) { failed.push({ id, message: "Programme introuvable" }); continue; }
          if (!canReviewProgram(program, req.user)) { failed.push({ id, message: "Non autorisé" }); continue; }
        } else if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
          failed.push({ id, message: "Non autorisé" });
          continue;
        }

        application.status = "REJECTED";
        application.reviewedBy = req.user.id;
        application.reviewedAt = new Date();
        await application.save();
        rejected += 1;
      } catch (itemError) {
        failed.push({ id, message: itemError.message || "Erreur" });
      }
    }

    res.json({ rejected, failed });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : vider toutes les candidatures d'un programme -------------------- */
/* Tous statuts confondus (en attente/acceptée/rejetée) — repartir de zéro
   pour recevoir un nouveau lot de candidatures. Sans risque pour les
   volontaires déjà admis : leur fiche Volunteer existe indépendamment
   (créée par finalizeAcceptance), seule la liste de candidatures est vidée. */
exports.deleteAllApplications = async (req, res, next) => {
  try {
    const { programId } = req.query;
    if (!programId) return res.status(400).json({ message: "programId requis" });

    const Application = getVolunteerApplicationModel();
    const query = {};

    if (programId === "spontaneous") {
      query.programId = null;
      if (!["ADMIN", "EDITOR"].includes(req.user.role)) {
        return res.status(403).json({ message: "Non autorisé" });
      }
    } else {
      const Program = getVolunteerProgramModel();
      const program = await Program.findById(programId);
      if (!program) return res.status(404).json({ message: "Programme introuvable" });
      if (!canReviewProgram(program, req.user)) {
        return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer les candidatures de ce programme" });
      }
      query.programId = programId;
    }

    const { deletedCount } = await Application.deleteMany(query);
    res.json({ deletedCount });
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
  // "Mon espace" (voir volunteerAuthController.js) : le compte EST ce
  // document Volunteer. Pas encore de mot de passe = pas encore de compte
  // actif, que la fiche vienne d'être créée ici ou qu'elle existait déjà
  // (ex. ajoutée à la main par le staff) — dans les deux cas on inclut un
  // lien d'activation dans l'email d'acceptation ci-dessous, jamais un
  // email séparé ni un mot de passe en clair.
  const needsActivationLink = !volunteer || !volunteer.password;

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

  const setPasswordUrl = needsActivationLink ? await generateSetPasswordUrl(volunteer) : null;
  await sendAcceptedEmail(application, program, setPasswordUrl);
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

/* `setPasswordUrl` : présent seulement si le volontaire n'a pas encore de
   compte actif — inclut alors un lien d'activation directement dans cet
   email (pas d'email séparé). Sinon, un simple lien vers la connexion. */
async function sendAcceptedEmail(application, program, setPasswordUrl) {
  const name = fullName(application);
  const loginUrl = `${FRONTEND_BASE}/mon-espace/login`;
  const spaceCtaText = setPasswordUrl
    ? "Votre espace volontaire est prêt : cliquez ci-dessous pour choisir votre mot de passe et suivre vos candidatures, vos missions et vos attestations."
    : "Retrouvez le suivi de vos candidatures, vos missions et vos attestations dans votre espace volontaire.";
  const spaceCtaUrl = setPasswordUrl || loginUrl;
  const spaceCtaLabel = setPasswordUrl ? "Activer mon espace volontaire" : "Voir mon espace volontaire";

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
        ``,
        spaceCtaText,
        spaceCtaUrl,
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
          `<p>${escapeHtml(spaceCtaText)}</p>`,
          `<p style="text-align:center;margin:28px 0;"><a href="${spaceCtaUrl}" style="display:inline-block;background:#1B4332;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">${escapeHtml(spaceCtaLabel)}</a></p>`,
        ].filter(Boolean).join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email d'admission volontaire:", mailError.message);
  }
}
