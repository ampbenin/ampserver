/**
 * Contrôleur Cours — Plateforme NumSAL
 * Logique sur-mesure (pas une factory générique) : un cours est filtré
 * par formateur propriétaire, et les leçons sont un sous-tableau qu'il
 * faut pouvoir ajouter/modifier/supprimer/réordonner individuellement.
 */

const crypto = require("crypto");
const getNumsalCourseModel = require("../../models/numsal/NumsalCourse");
const getNumsalEnrollmentModel = require("../../models/numsal/NumsalEnrollment");
const getNumsalApplicationModel = require("../../models/numsal/NumsalApplication");
const getNumsalUserModel = require("../../models/numsal/NumsalUser");
const resend = require("../../utils/resendMailer");
const { renderNumsalEmail, renderContactBlockText, escapeHtml } = require("../../utils/emailTemplates");

const MODALITY_LABELS = { ONLINE: "En ligne", IN_PERSON: "Présentiel", HYBRID: "Hybride" };

// Format hex strict (#RRGGBB) — cette valeur est réinjectée telle quelle dans
// une balise <style> côté candidat (voir ApplicationForm.jsx), donc on ne
// stocke jamais autre chose qu'un hex valide.
const isValidHexColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value);

/* Fait passer au statut CLOSED tout programme PUBLISHED dont la date limite
   de candidature est dépassée. Pas de tâche planifiée dans ce projet : cette
   fonction est donc appelée au début de chaque route qui lit/liste des
   programmes, ce qui suffit à garder le statut à jour en continu (le
   catalogue public et le tableau de bord admin sont consultés en
   permanence). Une fois CLOSED, un programme ne redevient PUBLISHED que si
   un formateur/admin le republie explicitement — choix confirmé par
   l'utilisateur (pas de réouverture automatique si la date est reculée). */
const closeExpiredCourses = async () => {
  const Course = getNumsalCourseModel();
  await Course.updateMany(
    { status: "PUBLISHED", applicationDeadline: { $ne: null, $lt: new Date() } },
    { status: "CLOSED" }
  );
};
exports.closeExpiredCourses = closeExpiredCourses;

/* Champs "système" toujours présents dans le formulaire de candidature.
   Nom/Email sont verrouillés (jamais supprimables — l'email sert à créer le
   compte du candidat admis) ; Téléphone est entièrement libre, comme un
   champ créé par le formateur. Injectés à la lecture pour les programmes
   créés avant l'introduction de ce mécanisme (pas de script de migration
   nécessaire — cohérent avec la manière dont ce projet gère déjà les
   nouveaux champs de schéma via les valeurs par défaut Mongoose). */
const DEFAULT_BUILTIN_FIELDS = [
  {
    id: "applicantName", label: "Quel est votre nom complet ?", type: "TEXT",
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

const LOCKED_FIELD_TYPES = { applicantName: "TEXT", applicantEmail: "EMAIL" };

const ensureBuiltinFields = (fields) => {
  const existingIds = new Set((fields || []).map((f) => f.id));
  const missing = DEFAULT_BUILTIN_FIELDS.filter((f) => !existingIds.has(f.id));
  return missing.length ? [...missing, ...(fields || [])] : fields || [];
};

const canReviewCourse = (course, user) => {
  if (user.role === "ADMIN") return true;
  if (course.trainerId.toString() === user.id) return true;
  return (course.tutorIds || []).some((id) => id.toString() === user.id);
};

const CONDITIONAL_TRIGGER_TYPES = ["SELECT", "CHECKBOX"];

/* Un champ conditionnel n'est visible que si son déclencheur (`fieldId`) est
   lui-même visible ET a répondu une valeur incluse dans `values`. Chaîne sur
   plusieurs niveaux ; `guard` protège contre une boucle de dépendance. */
const isFieldVisible = (field, responses, fieldsById, guard = new Set()) => {
  if (!field.conditional?.fieldId) return true;
  if (guard.has(field.id)) return false;

  const parent = fieldsById.get(field.conditional.fieldId);
  if (!parent) return false; // déclencheur supprimé/introuvable : champ orphelin, jamais visible

  guard.add(field.id);
  if (!isFieldVisible(parent, responses, fieldsById, guard)) return false;

  const rawParentValue = responses?.[parent.id];
  const parentValueStr = typeof rawParentValue === "boolean" ? String(rawParentValue) : (rawParentValue ?? "");
  return (field.conditional.values || []).includes(parentValueStr);
};

/* Valide la définition du formulaire elle-même (pas les réponses d'un
   candidat) : ids uniques, pas d'auto-référence, déclencheur d'un type
   autorisé, valeurs déclenchantes non vides, pas de boucle de dépendance. */
const validateFormFieldsDefinition = (fields) => {
  const ids = new Set();
  for (const f of fields) {
    if (!f.id || !f.label || !f.type) {
      return "Chaque champ doit avoir un identifiant, un libellé et un type";
    }
    if (ids.has(f.id)) return `Identifiant de champ dupliqué : ${f.id}`;
    ids.add(f.id);
  }

  for (const [lockedId, expectedType] of Object.entries(LOCKED_FIELD_TYPES)) {
    const field = fields.find((f) => f.id === lockedId);
    if (!field) {
      return `Le champ "${lockedId === "applicantName" ? "Nom complet" : "Email"}" est indispensable et ne peut pas être supprimé`;
    }
    if (field.type !== expectedType) {
      return `Le type du champ "${field.label}" ne peut pas être modifié`;
    }
    if (!field.required) {
      return `Le champ "${field.label}" doit rester obligatoire`;
    }
    if (field.conditional?.fieldId) {
      return `Le champ "${field.label}" doit toujours rester visible (pas de condition d'affichage)`;
    }
  }

  const byId = new Map(fields.map((f) => [f.id, f]));
  const indexById = new Map(fields.map((f, idx) => [f.id, idx]));

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.conditional?.fieldId) continue;

    if (f.conditional.fieldId === f.id) {
      return `Le champ "${f.label}" ne peut pas dépendre de lui-même`;
    }

    const parent = byId.get(f.conditional.fieldId);
    if (!parent) {
      return `Le champ "${f.label}" dépend d'un champ introuvable`;
    }
    if (!CONDITIONAL_TRIGGER_TYPES.includes(parent.type)) {
      return `Le champ "${f.label}" ne peut dépendre que d'une liste déroulante ou d'une case à cocher`;
    }
    if (!Array.isArray(f.conditional.values) || f.conditional.values.length === 0) {
      return `Le champ "${f.label}" doit préciser au moins une valeur déclenchante`;
    }

    // Le déclencheur doit toujours apparaître avant son sous-champ dans le
    // formulaire (sinon le candidat verrait la question dérivée avant la
    // question qui la déclenche) — cette contrainte de position empêche
    // aussi structurellement toute boucle de dépendance.
    if (indexById.get(f.conditional.fieldId) >= i) {
      return `Le champ "${f.label}" doit être placé après « ${parent.label} » dans le formulaire`;
    }
  }

  return null;
};

/* `responses` doit ici déjà inclure applicantName/applicantEmail/
   applicantPhone fusionnés (voir applyToCourse) — ces trois champs sont
   envoyés en paramètres de premier niveau par l'assistant candidat, pas
   dans son objet `responses` brut, qu'ils soient verrouillés ou non. */
const validateApplicationResponses = (fields, responses) => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const field of fields) {
    if (!isFieldVisible(field, responses, fieldsById)) continue;

    const value = responses?.[field.id];
    const isEmpty = value === undefined || value === null || value === "";

    if (field.required && isEmpty) {
      return `Le champ "${field.label}" est requis`;
    }
    if (isEmpty) continue;

    const v = field.validation || {};

    if (["TEXT", "TEXTAREA", "EMAIL", "PHONE"].includes(field.type)) {
      const str = String(value);
      if (v.minLength && str.length < v.minLength) {
        return `"${field.label}" doit contenir au moins ${v.minLength} caractères`;
      }
      if (v.maxLength && str.length > v.maxLength) {
        return `"${field.label}" doit contenir au plus ${v.maxLength} caractères`;
      }
      if (v.pattern) {
        try {
          if (!new RegExp(v.pattern).test(str)) {
            return `"${field.label}" ne respecte pas le format attendu`;
          }
        } catch {
          // pattern invalide côté formateur : ignoré plutôt que de bloquer le candidat
        }
      }
      if (field.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
        return `"${field.label}" doit être un email valide`;
      }
    }

    if (field.type === "NUMBER") {
      const num = Number(value);
      if (Number.isNaN(num)) return `"${field.label}" doit être un nombre`;
      if (v.min !== null && v.min !== undefined && num < v.min) {
        return `"${field.label}" doit être supérieur ou égal à ${v.min}`;
      }
      if (v.max !== null && v.max !== undefined && num > v.max) {
        return `"${field.label}" doit être inférieur ou égal à ${v.max}`;
      }
    }

    if (field.type === "SELECT" && field.options?.length && !field.options.includes(value)) {
      return `"${field.label}" doit être une des valeurs proposées`;
    }
  }
  return null;
};

const validateLessonPayload = (lesson) => {
  if (!lesson.title || !lesson.contentType) {
    return "title et contentType requis";
  }
  if (lesson.contentType === "TEXT" && !lesson.contentBody) {
    return "contentBody requis pour une leçon de type TEXT";
  }
  if (lesson.contentType !== "TEXT" && !lesson.contentUrl) {
    return "contentUrl requis pour ce type de leçon";
  }
  return null;
};

/* -------------------- Public : catalogue des cours publiés -------------------- */
exports.listPublicCourses = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    // Le populate ci-dessous résout "trainerId" par le nom de modèle
    // Mongoose "NumsalUser" (déclaré dans le schéma via `ref`) — ce nom
    // n'est enregistré dans ce process qu'au premier appel réel de
    // getNumsalUserModel(). Comme cette route est publique et peut donc être
    // la toute première requête servie après un redémarrage (avant qu'aucune
    // route authentifiée n'ait eu l'occasion d'enregistrer le modèle), on
    // force cet enregistrement ici pour éviter une erreur "Schema hasn't
    // been registered for model NumsalUser" sur un process fraîchement
    // démarré.
    getNumsalUserModel();
    await closeExpiredCourses();
    const courses = await Course.find({ status: "PUBLISHED" })
      .select("title description coverImageUrl trainerId lessons createdAt modality accessMode featuredOnHome duration applicationDeadline")
      .populate("trainerId", "name")
      .sort({ createdAt: -1 });

    const items = courses.map((c) => ({
      id: c._id,
      title: c.title,
      description: c.description,
      coverImageUrl: c.coverImageUrl,
      trainer: c.trainerId,
      lessonCount: c.lessons.length,
      createdAt: c.createdAt,
      modality: c.modality,
      accessMode: c.accessMode,
      featuredOnHome: c.featuredOnHome,
      duration: c.duration,
      applicationDeadline: c.applicationDeadline,
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Authentifié : détail complet d'un cours -------------------- */
/* Réservé au formateur propriétaire, à l'ADMIN, ou à un apprenant inscrit. */
exports.getCourseById = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    await closeExpiredCourses();
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const isOwner = course.trainerId.toString() === req.user.id;
    const isAdmin = req.user.role === "ADMIN";

    if (!isOwner && !isAdmin) {
      const Enrollment = getNumsalEnrollmentModel();
      const enrolled = await Enrollment.exists({ learnerId: req.user.id, courseId: course._id });
      if (!enrolled) {
        return res.status(403).json({ message: "Vous devez être inscrit à ce cours pour y accéder" });
      }
    }

    const courseObj = course.toObject();
    courseObj.applicationForm = {
      ...courseObj.applicationForm,
      fields: ensureBuiltinFields(courseObj.applicationForm?.fields),
    };

    res.json(courseObj);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : mes cours -------------------- */
exports.listMyCourses = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const courses = await Course.find({ trainerId: req.user.id }).sort({ createdAt: -1 });
    res.json({ items: courses });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Tuteur : programmes qui me sont rattachés (à évaluer) -------------------- */
exports.listCoursesToReview = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const courses = await Course.find({ tutorIds: req.user.id, accessMode: "APPLICATION" })
      .select("title modality")
      .sort({ createdAt: -1 });
    res.json({ items: courses });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur ou ADMIN : créer un cours -------------------- */
/* Un formateur devient automatiquement propriétaire de son cours. Un ADMIN
   doit choisir le formateur responsable (trainerId) — un programme reste
   toujours rattaché à un vrai compte FORMATEUR. */
exports.createCourse = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const {
      title, description, coverImageUrl, status, modality, accessMode,
      trainerId, featuredOnHome, duration, applicationDeadline, brandColor,
    } = req.body;

    if (!title) return res.status(400).json({ message: "Titre requis" });
    if (brandColor && !isValidHexColor(brandColor)) {
      return res.status(400).json({ message: "Couleur invalide (format attendu : #RRGGBB)" });
    }

    let ownerId = req.user.id;
    if (req.user.role === "ADMIN") {
      if (!trainerId) {
        return res.status(400).json({ message: "Veuillez choisir le formateur responsable du programme" });
      }
      const NumsalUser = getNumsalUserModel();
      const trainer = await NumsalUser.findOne({ _id: trainerId, role: "FORMATEUR" });
      if (!trainer) return res.status(400).json({ message: "Formateur introuvable" });
      ownerId = trainerId;
    }

    const course = await Course.create({
      title,
      description,
      coverImageUrl,
      status: status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      modality: ["ONLINE", "IN_PERSON", "HYBRID"].includes(modality) ? modality : "ONLINE",
      accessMode: accessMode === "OPEN" ? "OPEN" : "APPLICATION",
      featuredOnHome: !!featuredOnHome,
      duration: duration || "",
      applicationDeadline: applicationDeadline || null,
      brandColor: brandColor || "",
      trainerId: ownerId,
    });

    res.status(201).json(course);
  } catch (error) {
    next(error);
  }
};

/* ADMIN peut éditer/gérer n'importe quel cours ; un formateur reste limité
   aux siens (vérifié par trainerId). */
const findEditableCourse = async (Course, courseId, user) => {
  if (user.role === "ADMIN") return Course.findById(courseId);
  return Course.findOne({ _id: courseId, trainerId: user.id });
};

/* -------------------- Formateur : modifier les métadonnées d'un cours -------------------- */
exports.updateCourseMeta = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const course = await findEditableCourse(Course, req.params.id, req.user);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const {
      title, description, coverImageUrl, status,
      modality, accessMode, admissionInstructions, applicationFormFields,
      contactWhatsapp, contactEmail, featuredOnHome, trainerId, estimatedDuration,
      duration, applicationDeadline, brandColor,
    } = req.body;

    if (brandColor && !isValidHexColor(brandColor)) {
      return res.status(400).json({ message: "Couleur invalide (format attendu : #RRGGBB)" });
    }

    if (title !== undefined) course.title = title;
    if (description !== undefined) course.description = description;
    if (coverImageUrl !== undefined) course.coverImageUrl = coverImageUrl;
    if (status !== undefined) course.status = status;
    if (modality !== undefined) course.modality = modality;
    if (accessMode !== undefined) course.accessMode = accessMode;
    if (admissionInstructions !== undefined) course.admissionInstructions = admissionInstructions;
    if (contactWhatsapp !== undefined) course.contactWhatsapp = contactWhatsapp;
    if (contactEmail !== undefined) course.contactEmail = contactEmail;
    if (featuredOnHome !== undefined) course.featuredOnHome = !!featuredOnHome;
    if (duration !== undefined) course.duration = duration;
    if (applicationDeadline !== undefined) course.applicationDeadline = applicationDeadline || null;
    if (brandColor !== undefined) course.brandColor = brandColor;
    // Réattribuer le formateur responsable est réservé à l'ADMIN — un
    // formateur ne doit pas pouvoir céder/transférer son propre programme.
    if (trainerId !== undefined && trainerId !== String(course.trainerId)) {
      if (req.user.role !== "ADMIN") {
        return res.status(403).json({ message: "Seul un administrateur peut réattribuer le formateur responsable" });
      }
      const NumsalUser = getNumsalUserModel();
      const trainer = await NumsalUser.findOne({ _id: trainerId, role: "FORMATEUR" });
      if (!trainer) return res.status(400).json({ message: "Formateur introuvable" });
      course.trainerId = trainerId;
    }
    // Mutation champ par champ (jamais un remplacement complet de
    // `applicationForm`) pour qu'enregistrer les champs et enregistrer la
    // durée estimée restent deux actions indépendantes, sans que l'une
    // écrase silencieusement l'autre.
    if (estimatedDuration !== undefined) {
      course.applicationForm.estimatedDuration = estimatedDuration;
    }
    if (Array.isArray(applicationFormFields)) {
      const defError = validateFormFieldsDefinition(applicationFormFields);
      if (defError) return res.status(400).json({ message: defError });
      course.applicationForm.fields = applicationFormFields;
    }

    await course.save();
    res.json(course);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : supprimer un cours -------------------- */
exports.deleteCourse = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Enrollment = getNumsalEnrollmentModel();

    const course = await findEditableCourse(Course, req.params.id, req.user);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const hasEnrollments = await Enrollment.exists({ courseId: course._id });
    if (hasEnrollments) {
      return res.status(409).json({
        message: "Impossible de supprimer : des apprenants sont déjà inscrits à ce cours",
      });
    }

    await course.deleteOne();
    res.json({ success: true, message: "Cours supprimé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : ajouter une leçon -------------------- */
exports.addLesson = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const course = await findEditableCourse(Course, req.params.id, req.user);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const error = validateLessonPayload(req.body);
    if (error) return res.status(400).json({ message: error });

    const { title, contentType, contentBody, contentUrl } = req.body;
    const order = course.lessons.length
      ? Math.max(...course.lessons.map((l) => l.order)) + 1
      : 0;

    course.lessons.push({ title, contentType, contentBody, contentUrl, order });
    await course.save();

    res.status(201).json(course);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : modifier une leçon -------------------- */
exports.updateLesson = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const course = await findEditableCourse(Course, req.params.id, req.user);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const lesson = course.lessons.id(req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: "Leçon introuvable" });

    const merged = { ...lesson.toObject(), ...req.body };
    const error = validateLessonPayload(merged);
    if (error) return res.status(400).json({ message: error });

    ["title", "contentType", "contentBody", "contentUrl"].forEach((field) => {
      if (req.body[field] !== undefined) lesson[field] = req.body[field];
    });

    await course.save();
    res.json(course);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : supprimer une leçon -------------------- */
exports.deleteLesson = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const course = await findEditableCourse(Course, req.params.id, req.user);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const lesson = course.lessons.id(req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: "Leçon introuvable" });

    lesson.deleteOne();
    await course.save();

    res.json(course);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : réordonner les leçons -------------------- */
/* Body: { lessonIds: ["<id dans le nouvel ordre>", ...] } */
exports.reorderLessons = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const course = await findEditableCourse(Course, req.params.id, req.user);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds) || lessonIds.length !== course.lessons.length) {
      return res.status(400).json({ message: "lessonIds doit contenir exactement toutes les leçons du cours" });
    }

    lessonIds.forEach((lessonId, index) => {
      const lesson = course.lessons.id(lessonId);
      if (lesson) lesson.order = index;
    });

    await course.save();
    res.json(course);
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : schéma du formulaire de candidature d'un programme -------------------- */
/* Nécessaire car getCourseById est réservé aux inscrits/propriétaire — un
   candidat sans compte doit pouvoir voir les champs à remplir. */
exports.getApplicationForm = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    getNumsalUserModel(); // voir le commentaire équivalent dans listPublicCourses
    await closeExpiredCourses();
    const course = await Course.findById(req.params.id)
      .select("title description modality accessMode status applicationForm admissionInstructions lessons duration applicationDeadline brandColor")
      .populate("trainerId", "name");

    if (!course || course.status === "DRAFT" || course.status === "ARCHIVED") {
      return res.status(404).json({ message: "Programme introuvable" });
    }
    if (course.status === "CLOSED") {
      return res.status(400).json({ message: "Les candidatures pour ce programme sont closes (date limite dépassée)." });
    }
    if (course.accessMode !== "APPLICATION") {
      return res.status(400).json({ message: "Ce programme est en accès direct, aucune candidature n'est nécessaire" });
    }

    res.json({
      title: course.title,
      description: course.description,
      modality: course.modality,
      trainerName: course.trainerId?.name || "",
      admissionInstructions: course.admissionInstructions || "",
      lessonCount: (course.lessons || []).length,
      duration: course.duration || "",
      applicationDeadline: course.applicationDeadline,
      brandColor: course.brandColor || "",
      estimatedDuration: course.applicationForm?.estimatedDuration || "",
      fields: ensureBuiltinFields(course.applicationForm?.fields),
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : postuler à un programme sur candidature -------------------- */
exports.applyToCourse = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Application = getNumsalApplicationModel();

    await closeExpiredCourses();
    const course = await Course.findById(req.params.id);
    if (!course || course.status === "DRAFT" || course.status === "ARCHIVED") {
      return res.status(404).json({ message: "Programme introuvable" });
    }
    if (course.status === "CLOSED") {
      return res.status(400).json({ message: "Les candidatures pour ce programme sont closes (date limite dépassée)." });
    }

    if (course.accessMode !== "APPLICATION") {
      return res.status(400).json({
        message: "Ce programme est en accès direct, aucune candidature n'est nécessaire",
      });
    }

    const { applicantName, applicantEmail, applicantPhone, responses } = req.body;
    if (!applicantName || !applicantEmail) {
      return res.status(400).json({ message: "Nom et email requis" });
    }

    // applicantName/applicantEmail/applicantPhone arrivent en paramètres de
    // premier niveau (pas dans `responses`) — on les fusionne ici uniquement
    // pour la validation, qui doit pouvoir vérifier leur présence/format
    // comme n'importe quel autre champ du formulaire (ex: si le formateur a
    // rendu Téléphone obligatoire, désormais un champ librement modifiable).
    const validationError = validateApplicationResponses(
      course.applicationForm?.fields || [],
      { ...(responses || {}), applicantName, applicantEmail, applicantPhone }
    );
    if (validationError) return res.status(400).json({ message: validationError });

    const application = await Application.create({
      courseId: course._id,
      applicantName,
      applicantEmail,
      applicantPhone,
      responses: responses || {},
    });

    const modalityLabel = MODALITY_LABELS[course.modality] || course.modality;
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "NumSAL <onboarding@resend.dev>",
        to: applicantEmail,
        subject: `Candidature reçue — ${course.title}`,
        text: [
          `Bonjour ${applicantName},`,
          ``,
          `Nous avons bien reçu votre candidature au programme "${course.title}" (${modalityLabel}).`,
          `Notre équipe va l'examiner et vous serez averti(e) par email si votre profil est retenu.`,
          ``,
          `Merci de votre intérêt pour NumSAL !`,
          renderContactBlockText(course),
        ].join("\n"),
        html: renderNumsalEmail({
          title: "Candidature reçue",
          course,
          bodyHtml: [
            `<p>Bonjour ${escapeHtml(applicantName)},</p>`,
            `<p>Nous avons bien reçu votre candidature au programme <strong>${escapeHtml(course.title)}</strong> (${escapeHtml(modalityLabel)}).</p>`,
            `<p>Notre équipe va l'examiner et vous serez averti(e) par email si votre profil est retenu.</p>`,
            `<p>Merci de votre intérêt pour NumSAL !</p>`,
          ].join(""),
        }),
      });
    } catch (mailError) {
      console.error("❌ Erreur envoi email de réception de candidature NumSAL:", mailError.message);
    }

    res.status(201).json({ message: "Candidature envoyée avec succès", id: application._id });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Vous avez déjà postulé à ce programme" });
    }
    next(error);
  }
};

/* -------------------- Formateur/tuteur rattaché/admin : lister les candidatures -------------------- */
exports.listApplications = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Application = getNumsalApplicationModel();

    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });
    if (!canReviewCourse(course, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à consulter les candidatures de ce programme" });
    }

    const applications = await Application.find({ courseId: course._id }).sort({ createdAt: -1 });
    res.json({ items: applications });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur/tuteur rattaché/admin : accepter une candidature -------------------- */
/* Crée (ou réutilise) le compte apprenant, l'inscription au cours, et envoie l'email d'admission. */
exports.acceptApplication = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Application = getNumsalApplicationModel();
    const NumsalUser = getNumsalUserModel();
    const Enrollment = getNumsalEnrollmentModel();

    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });
    if (!canReviewCourse(course, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à évaluer ce programme" });
    }

    const application = await Application.findOne({ _id: req.params.applicationId, courseId: course._id });
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });
    if (application.status !== "PENDING") {
      return res.status(409).json({ message: "Cette candidature a déjà été traitée" });
    }

    let learner = await NumsalUser.findOne({ email: application.applicantEmail });
    let isNewAccount = false;
    let tempPassword = null;

    if (!learner) {
      tempPassword = crypto.randomBytes(6).toString("hex");
      learner = await NumsalUser.create({
        name: application.applicantName,
        email: application.applicantEmail,
        password: tempPassword,
        role: "APPRENANT",
        mustChangePassword: true,
      });
      isNewAccount = true;
    }

    await Enrollment.findOneAndUpdate(
      { learnerId: learner._id, courseId: course._id },
      { $setOnInsert: { learnerId: learner._id, courseId: course._id } },
      { upsert: true, new: true }
    );

    application.status = "ACCEPTED";
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    await application.save();

    const loginUrl = process.env.NUMSAL_FRONTEND_URL || "https://numsal.ampbenin.org";
    const modalityLabel = MODALITY_LABELS[course.modality] || course.modality;

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "NumSAL <onboarding@resend.dev>",
        to: application.applicantEmail,
        subject: `Admission au programme "${course.title}" — NumSAL`,
        text: [
          `Bonjour ${application.applicantName},`,
          ``,
          `Félicitations, votre candidature au programme "${course.title}" (${modalityLabel}) a été retenue.`,
          course.admissionInstructions ? `\n${course.admissionInstructions}\n` : "",
          isNewAccount
            ? `Un compte a été créé pour vous sur NumSAL :\nEmail : ${application.applicantEmail}\nMot de passe temporaire : ${tempPassword}\nVous devrez le changer dès votre première connexion.`
            : `Vous pouvez accéder au programme dès maintenant avec votre compte NumSAL existant.`,
          ``,
          `Connectez-vous ici : ${loginUrl}/login`,
          renderContactBlockText(course),
        ].filter(Boolean).join("\n"),
        html: renderNumsalEmail({
          title: "Candidature retenue 🎉",
          course,
          bodyHtml: [
            `<p>Bonjour ${escapeHtml(application.applicantName)},</p>`,
            `<p>Félicitations, votre candidature au programme <strong>${escapeHtml(course.title)}</strong> (${escapeHtml(modalityLabel)}) a été retenue.</p>`,
            course.admissionInstructions
              ? `<p>${escapeHtml(course.admissionInstructions).replace(/\n/g, "<br>")}</p>`
              : "",
            isNewAccount
              ? `<p>Un compte a été créé pour vous sur NumSAL :<br>Email : ${escapeHtml(application.applicantEmail)}<br>Mot de passe temporaire : <strong>${escapeHtml(tempPassword)}</strong><br>Vous devrez le changer dès votre première connexion.</p>`
              : `<p>Vous pouvez accéder au programme dès maintenant avec votre compte NumSAL existant.</p>`,
            `<p style="text-align:center;margin-top:24px;"><a href="${loginUrl}/login" style="display:inline-block;background:#C9903A;color:#111111;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;">Se connecter à NumSAL →</a></p>`,
          ].filter(Boolean).join(""),
        }),
      });
    } catch (mailError) {
      console.error("❌ Erreur envoi email d'admission NumSAL:", mailError.message);
    }

    res.json({ message: "Candidature acceptée, email d'admission envoyé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur/tuteur rattaché/admin : rejeter une candidature -------------------- */
exports.rejectApplication = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Application = getNumsalApplicationModel();

    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });
    if (!canReviewCourse(course, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à évaluer ce programme" });
    }

    const application = await Application.findOne({ _id: req.params.applicationId, courseId: course._id });
    if (!application) return res.status(404).json({ message: "Candidature introuvable" });
    if (application.status !== "PENDING") {
      return res.status(409).json({ message: "Cette candidature a déjà été traitée" });
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
