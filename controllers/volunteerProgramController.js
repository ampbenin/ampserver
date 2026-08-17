/**
 * Contrôleur Programmes de volontariat — AMP Bénin
 * Remplace missionController.js : un programme a un vrai statut de
 * publication, un formulaire de candidature personnalisable, et se ferme
 * automatiquement à l'échéance. Même logique que NumSAL
 * (controllers/numsal/courseController.js), adaptée : pas de
 * "propriétaire" par programme (ADMIN gère tout, un EDITOR seulement les
 * programmes qui lui sont affectés via editorIds, plus des reviewerIds
 * optionnels pour d'autres rôles), pas de leçons.
 */

const streamifier = require("streamifier");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getUserModel = require("../models/gestionamp/User");
const { ensureBuiltinFields, validateFormFieldsDefinition } = require("../utils/applicationFormLogic");
const cloudinary = require("../utils/cloudinary");

// Format hex strict (#RRGGBB) — cette valeur est réinjectée telle quelle dans
// une balise <style> côté candidat, donc on ne stocke jamais autre chose
// qu'un hex valide.
const isValidHexColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value);

/* Champs "système" toujours présents dans le formulaire de candidature.
   Prénom/Nom/Email sont verrouillés (Email indispensable pour retrouver ou
   créer le profil Volunteer à l'admission) ; Téléphone est entièrement
   libre. Séparés en Prénom/Nom (contrairement au "nom complet" unique de
   NumSAL) pour correspondre directement à Volunteer.prenom/nom sans devoir
   deviner où couper un nom complet. */
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
const LOCKED_BUILTIN_FIELDS = DEFAULT_BUILTIN_FIELDS.filter((f) => f.locked);
exports.DEFAULT_BUILTIN_FIELDS = DEFAULT_BUILTIN_FIELDS;

/* Fait passer au statut CLOSED tout programme PUBLISHED dont la date limite
   de candidature est dépassée. Pas de tâche planifiée dans ce projet : cette
   fonction est donc appelée au début de chaque route qui lit/liste des
   programmes. Un programme CLOSED ne redevient PUBLISHED que si un
   ADMIN/EDITOR le republie explicitement. */
const closeExpiredPrograms = async () => {
  const Program = getVolunteerProgramModel();
  await Program.updateMany(
    { status: "PUBLISHED", applicationDeadline: { $ne: null, $lt: new Date() } },
    { status: "CLOSED" }
  );
};
exports.closeExpiredPrograms = closeExpiredPrograms;

// ADMIN gère tout programme sans condition. Un EDITOR ne gère que les
// programmes où il figure dans editorIds — plus d'accès blanket depuis le
// 2026-08-17 (décision utilisateur : "quand on lui affecte un programme, il
// peut tout gérer sur ce programme comme il était admin", donc pas avant).
// Les autres rôles (EC/IS/SUPERVISEUR...) passent par reviewerIds, un
// mécanisme distinct et inchangé, plus restreint dans les faits car les
// routes de réglages du programme (settings/suppression/affectations) leur
// restent de toute façon fermées par le rôle au niveau de la route.
const canReviewProgram = (program, user) => {
  if (user.role === "ADMIN") return true;
  if (user.role === "EDITOR") {
    return (program.editorIds || []).some((id) => id.toString() === user.id);
  }
  return (program.reviewerIds || []).some((id) => id.toString() === user.id);
};
exports.canReviewProgram = canReviewProgram;

/* -------------------- Public : catalogue des programmes publiés -------------------- */
exports.listPublicPrograms = async (req, res, next) => {
  try {
    await closeExpiredPrograms();
    const Program = getVolunteerProgramModel();
    const programs = await Program.find({ status: "PUBLISHED" })
      .select("title description coverImageUrl location startDate endDate accessMode applicationDeadline")
      .sort({ createdAt: -1 });

    res.json({ items: programs });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : détail complet d'un programme -------------------- */
exports.getProgramById = async (req, res, next) => {
  try {
    await closeExpiredPrograms();
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const programObj = program.toObject();
    programObj.applicationForm = {
      ...programObj.applicationForm,
      fields: ensureBuiltinFields(programObj.applicationForm?.fields, DEFAULT_BUILTIN_FIELDS),
    };

    res.json(programObj);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : liste complète (gestion) -------------------- */
/* Un EDITOR ne voit que les programmes qui lui sont affectés (editorIds) —
   ADMIN voit tout, sans condition. */
exports.listAllPrograms = async (req, res, next) => {
  try {
    await closeExpiredPrograms();
    const Program = getVolunteerProgramModel();
    const query = req.user.role === "EDITOR" ? { editorIds: req.user.id } : {};
    const programs = await Program.find(query)
      .select("title status location startDate endDate accessMode applicationDeadline capacity")
      .sort({ createdAt: -1 });
    res.json({ items: programs });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : créer un programme -------------------- */
/* Un EDITOR qui crée un programme y est automatiquement affecté (editorIds)
   — sinon il se retrouverait aussitôt hors du programme qu'il vient de
   créer, puisqu'il ne gère plus que ce qui lui est explicitement affecté. */
exports.createProgram = async (req, res, next) => {
  try {
    const Program = getVolunteerProgramModel();
    const {
      title, description, coverImageUrl, status, location, startDate, endDate,
      capacity, accessMode, applicationDeadline, brandColor,
    } = req.body;

    if (!title) return res.status(400).json({ message: "Titre requis" });
    if (brandColor && !isValidHexColor(brandColor)) {
      return res.status(400).json({ message: "Couleur invalide (format attendu : #RRGGBB)" });
    }

    const program = await Program.create({
      title,
      description,
      coverImageUrl,
      status: status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      location,
      startDate: startDate || null,
      endDate: endDate || null,
      capacity: capacity || null,
      accessMode: accessMode === "OPEN" ? "OPEN" : "APPLICATION",
      applicationDeadline: applicationDeadline || null,
      brandColor: brandColor || "",
      createdBy: req.user.id,
      editorIds: req.user.role === "EDITOR" ? [req.user.id] : [],
    });

    res.status(201).json(program);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : modifier un programme -------------------- */
exports.updateProgramMeta = async (req, res, next) => {
  try {
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const {
      title, description, coverImageUrl, status, location, startDate, endDate,
      capacity, accessMode, applicationDeadline, brandColor,
      admissionInstructions, contactWhatsapp, contactEmail,
      applicationFormFields, estimatedDuration, reviewerIds,
      programTasks, missionValidationThreshold,
    } = req.body;

    if (brandColor !== undefined && brandColor && !isValidHexColor(brandColor)) {
      return res.status(400).json({ message: "Couleur invalide (format attendu : #RRGGBB)" });
    }

    if (title !== undefined) program.title = title;
    if (description !== undefined) program.description = description;
    if (coverImageUrl !== undefined) program.coverImageUrl = coverImageUrl;
    if (status !== undefined) program.status = status;
    if (location !== undefined) program.location = location;
    if (startDate !== undefined) program.startDate = startDate || null;
    if (endDate !== undefined) program.endDate = endDate || null;
    if (capacity !== undefined) program.capacity = capacity || null;
    if (accessMode !== undefined) program.accessMode = accessMode;
    if (applicationDeadline !== undefined) program.applicationDeadline = applicationDeadline || null;
    if (brandColor !== undefined) program.brandColor = brandColor;
    if (admissionInstructions !== undefined) program.admissionInstructions = admissionInstructions;
    if (contactWhatsapp !== undefined) program.contactWhatsapp = contactWhatsapp;
    if (contactEmail !== undefined) program.contactEmail = contactEmail;
    if (Array.isArray(reviewerIds)) program.reviewerIds = reviewerIds;

    // Mutation champ par champ (jamais un remplacement complet
    // d'applicationForm) pour qu'enregistrer les champs et enregistrer la
    // durée estimée restent deux actions indépendantes.
    if (estimatedDuration !== undefined) {
      program.applicationForm.estimatedDuration = estimatedDuration;
    }
    if (Array.isArray(applicationFormFields)) {
      const defError = validateFormFieldsDefinition(applicationFormFields, LOCKED_BUILTIN_FIELDS);
      if (defError) return res.status(400).json({ message: defError });
      program.applicationForm.fields = applicationFormFields;
    }

    if (Array.isArray(programTasks)) {
      for (const task of programTasks) {
        if (!task.id || !task.title) {
          return res.status(400).json({ message: "Chaque tâche doit avoir un identifiant et un titre" });
        }
        if (!["ONCE", "DAILY", "WEEKLY"].includes(task.recurrence)) {
          return res.status(400).json({ message: `Récurrence invalide pour la tâche "${task.title}"` });
        }
        const proofFields = task.proofForm?.fields;
        if (Array.isArray(proofFields) && proofFields.length > 0) {
          // Pas de champ verrouillé pour un formulaire de preuve de tâche.
          const proofError = validateFormFieldsDefinition(proofFields, []);
          if (proofError) return res.status(400).json({ message: `Tâche "${task.title}" : ${proofError}` });
        }
      }
      program.tasks = programTasks;
    }
    if (missionValidationThreshold !== undefined) {
      const threshold = Number(missionValidationThreshold);
      if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
        return res.status(400).json({ message: "Le seuil de validation doit être un nombre entre 0 et 100" });
      }
      program.missionValidationThreshold = threshold;
    }

    await program.save();
    res.json(program);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : supprimer un programme -------------------- */
exports.deleteProgram = async (req, res, next) => {
  try {
    const Program = getVolunteerProgramModel();
    const Application = getVolunteerApplicationModel();

    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const hasApplications = await Application.exists({ programId: program._id });
    if (hasApplications) {
      return res.status(409).json({
        message: "Impossible de supprimer : des candidatures existent déjà pour ce programme",
      });
    }

    await program.deleteOne();
    res.json({ success: true, message: "Programme supprimé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN/EDITOR : affecter un superviseur à ce programme -------------------- */
/* Un SUPERVISEUR ne suit jamais tout un programme automatiquement : on lui
   affecte ici un sous-ensemble précis de volontaires de CE programme
   (remplace l'affectation existante pour ce programme s'il y en avait déjà
   une). volunteerIds vides = retire le superviseur de ce programme. */
exports.setSupervisorAssignment = async (req, res, next) => {
  try {
    const { supervisorId, volunteerIds } = req.body;
    if (!supervisorId || !Array.isArray(volunteerIds)) {
      return res.status(400).json({ message: "supervisorId et volunteerIds (tableau) requis" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const User = getUserModel();
    const supervisor = await User.findById(supervisorId);
    if (!supervisor) return res.status(404).json({ message: "Superviseur introuvable" });
    if (supervisor.role !== "SUPERVISEUR") {
      return res.status(400).json({ message: "Ce compte n'a pas le rôle SUPERVISEUR" });
    }

    const others = supervisor.supervisedAssignments.filter(
      (a) => a.programId.toString() !== program._id.toString()
    );
    supervisor.supervisedAssignments = volunteerIds.length > 0
      ? [...others, { programId: program._id, volunteerIds }]
      : others;
    await supervisor.save();

    res.json({ message: "Affectation enregistrée", supervisedAssignments: supervisor.supervisedAssignments });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN/EDITOR : ajouter/retirer un partenaire de ce programme -------------------- */
exports.setPartnerAccess = async (req, res, next) => {
  try {
    const { partnerId, action } = req.body;
    if (!partnerId || !["add", "remove"].includes(action)) {
      return res.status(400).json({ message: 'partnerId et action ("add"|"remove") requis' });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const User = getUserModel();
    const partner = await User.findById(partnerId);
    if (!partner) return res.status(404).json({ message: "Partenaire introuvable" });
    if (partner.role !== "PARTENAIRE") {
      return res.status(400).json({ message: "Ce compte n'a pas le rôle PARTENAIRE" });
    }

    const already = partner.partnerProgramIds.some((id) => id.toString() === program._id.toString());
    if (action === "add" && !already) {
      partner.partnerProgramIds.push(program._id);
    } else if (action === "remove" && already) {
      partner.partnerProgramIds = partner.partnerProgramIds.filter((id) => id.toString() !== program._id.toString());
    }
    await partner.save();

    res.json({ message: "Accès partenaire mis à jour", partnerProgramIds: partner.partnerProgramIds });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN : affecter/retirer un EDITOR sur ce programme -------------------- */
/* Un EDITOR affecté obtient exactement les mêmes pouvoirs qu'un ADMIN sur CE
   programme (voir canReviewProgram) — réservé à ADMIN, un EDITOR ne peut pas
   s'auto-affecter ni affecter un autre EDITOR (voir requireAdminOnly dans
   les routes). */
exports.setEditorAccess = async (req, res, next) => {
  try {
    const { editorId, action } = req.body;
    if (!editorId || !["add", "remove"].includes(action)) {
      return res.status(400).json({ message: 'editorId et action ("add"|"remove") requis' });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const User = getUserModel();
    const editor = await User.findById(editorId);
    if (!editor) return res.status(404).json({ message: "Compte introuvable" });
    if (editor.role !== "EDITOR") {
      return res.status(400).json({ message: "Ce compte n'a pas le rôle EDITOR" });
    }

    const already = program.editorIds.some((id) => id.toString() === editor._id.toString());
    if (action === "add" && !already) {
      program.editorIds.push(editor._id);
    } else if (action === "remove" && already) {
      program.editorIds = program.editorIds.filter((id) => id.toString() !== editor._id.toString());
    }
    await program.save();

    res.json({ message: "Affectation éditeur mise à jour", editorIds: program.editorIds });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN/EDITOR : bannière "Barre des partenaires" de CE programme -------------------- */
/* Propre à chaque programme (voir models/volunteerProgram.js#partnersBarImageUrl
   pour le contexte) — seuls les partenaires suivant CE programme la
   verront, jamais un réglage global. */
exports.uploadPartnersBarImage = async (req, res, next) => {
  try {
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

    const uploaded = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "ong-site/program-partners-bar", resource_type: "image" },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    program.partnersBarImageUrl = uploaded.secure_url;
    await program.save();

    res.json({ message: "Barre des partenaires mise à jour", partnersBarImageUrl: program.partnersBarImageUrl });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : schéma du formulaire de candidature d'un programme -------------------- */
exports.getApplicationForm = async (req, res, next) => {
  try {
    await closeExpiredPrograms();
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(req.params.id)
      .select("title description location startDate endDate accessMode status applicationForm admissionInstructions duration applicationDeadline brandColor");

    if (!program || program.status === "DRAFT" || program.status === "ARCHIVED") {
      return res.status(404).json({ message: "Programme introuvable" });
    }
    if (program.status === "CLOSED") {
      return res.status(400).json({ message: "Les candidatures pour ce programme sont closes (date limite dépassée)." });
    }

    res.json({
      title: program.title,
      description: program.description,
      location: program.location,
      startDate: program.startDate,
      endDate: program.endDate,
      accessMode: program.accessMode,
      admissionInstructions: program.admissionInstructions || "",
      applicationDeadline: program.applicationDeadline,
      brandColor: program.brandColor || "",
      estimatedDuration: program.applicationForm?.estimatedDuration || "",
      fields: ensureBuiltinFields(program.applicationForm?.fields, DEFAULT_BUILTIN_FIELDS),
    });
  } catch (error) {
    next(error);
  }
};
