/**
 * Contrôleur Programmes de volontariat — AMP Bénin
 * Remplace missionController.js : un programme a un vrai statut de
 * publication, un formulaire de candidature personnalisable, et se ferme
 * automatiquement à l'échéance. Même logique que NumSAL
 * (controllers/numsal/courseController.js), adaptée : pas de
 * "propriétaire" par programme (tout ADMIN/EDITOR peut gérer tout
 * programme, plus des reviewerIds optionnels), pas de leçons.
 */

const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const { ensureBuiltinFields, validateFormFieldsDefinition } = require("../utils/applicationFormLogic");

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

const canReviewProgram = (program, user) => {
  if (user.role === "ADMIN" || user.role === "EDITOR") return true;
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
exports.listAllPrograms = async (req, res, next) => {
  try {
    await closeExpiredPrograms();
    const Program = getVolunteerProgramModel();
    const programs = await Program.find()
      .select("title status location startDate endDate accessMode applicationDeadline capacity")
      .sort({ createdAt: -1 });
    res.json({ items: programs });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR) : créer un programme -------------------- */
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

    const {
      title, description, coverImageUrl, status, location, startDate, endDate,
      capacity, accessMode, applicationDeadline, brandColor,
      admissionInstructions, contactWhatsapp, contactEmail,
      applicationFormFields, estimatedDuration, reviewerIds,
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
