/**
 * Contrôleur "Réinitialisation d'urgence" — mesure temporaire activable
 * depuis l'espace ADMIN pour débloquer des volontaires dont le lien de
 * définition de mot de passe a expiré (voir models/emergencyResetBatch.js
 * pour le contexte complet et les décisions de structure).
 *
 * Deux familles de routes :
 * - ADMIN (protégées) : créer/lister/désactiver des lots.
 * - Publiques (le lien partagé lui-même) : vérifier le lot par token,
 *   vérifier l'identité (question de contrôle), réinitialiser le mot de
 *   passe.
 */

const crypto = require("crypto");
const Volunteer = require("../models/volunteer");
const EmergencyResetBatch = require("../models/emergencyResetBatch");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const loginAttemptLimiter = require("../utils/loginAttemptLimiter");

const VALID_FIELDS = ["nom", "prenom", "telephone", "age"];
const FIELD_LABELS = { nom: "votre nom", prenom: "votre prénom", telephone: "votre numéro de téléphone", age: "votre âge" };
const MIN_EXPIRES_HOURS = 1;
const MAX_EXPIRES_HOURS = 336; // 14 jours — garde-fou, la mesure est censée être temporaire
const DEFAULT_EXPIRES_HOURS = 48;

function computeAge(dateNaissance) {
  const today = new Date();
  const birth = new Date(dateNaissance);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function hasFieldData(volunteer, field) {
  switch (field) {
    case "nom": return !!volunteer.nom;
    case "prenom": return !!volunteer.prenom;
    case "telephone": return !!(volunteer.telephone && String(volunteer.telephone).trim());
    case "age": return !!volunteer.dateNaissance;
    default: return false;
  }
}

function compareAnswer(volunteer, field, answer) {
  const normalize = (s) => String(s ?? "").trim().toLowerCase();
  switch (field) {
    case "nom": return normalize(volunteer.nom) === normalize(answer) && normalize(answer) !== "";
    case "prenom": return normalize(volunteer.prenom) === normalize(answer) && normalize(answer) !== "";
    case "telephone": {
      const digitsOnly = (s) => String(s ?? "").replace(/\D/g, "");
      const a = digitsOnly(volunteer.telephone);
      const b = digitsOnly(answer);
      return a !== "" && a === b;
    }
    case "age": {
      if (!volunteer.dateNaissance) return false;
      const submitted = parseInt(answer, 10);
      if (Number.isNaN(submitted)) return false;
      return computeAge(volunteer.dateNaissance) === submitted;
    }
    default: return false;
  }
}

async function isVolunteerInBatchScope(batch, volunteer) {
  if (batch.targetType === "VOLUNTEERS") {
    return batch.volunteerIds.some((id) => id.toString() === volunteer._id.toString());
  }
  return (volunteer.programs || []).some((p) => p.programId.toString() === String(batch.programId));
}

async function resolveTargetVolunteers(targetType, { volunteerIds, programId }) {
  if (targetType === "VOLUNTEERS") {
    return Volunteer.find({ _id: { $in: volunteerIds } });
  }
  return Volunteer.find({ "programs.programId": programId });
}

/* ==================== ADMIN ==================== */

/* -------------------- ADMIN : créer un lot -------------------- */
exports.createBatch = async (req, res, next) => {
  try {
    const { targetType, volunteerIds, programId, validationField, expiresInHours } = req.body;

    if (!["VOLUNTEERS", "PROGRAM"].includes(targetType)) {
      return res.status(400).json({ message: 'targetType doit être "VOLUNTEERS" ou "PROGRAM"' });
    }
    if (!VALID_FIELDS.includes(validationField)) {
      return res.status(400).json({ message: `validationField doit être l'un de : ${VALID_FIELDS.join(", ")}` });
    }
    if (targetType === "VOLUNTEERS" && (!Array.isArray(volunteerIds) || volunteerIds.length === 0)) {
      return res.status(400).json({ message: "Sélectionnez au moins un volontaire" });
    }
    if (targetType === "PROGRAM" && !programId) {
      return res.status(400).json({ message: "programId requis" });
    }

    const hours = Math.min(Math.max(Number(expiresInHours) || DEFAULT_EXPIRES_HOURS, MIN_EXPIRES_HOURS), MAX_EXPIRES_HOURS);

    const targetVolunteers = await resolveTargetVolunteers(targetType, { volunteerIds, programId });
    if (targetVolunteers.length === 0) {
      return res.status(400).json({ message: "Aucun volontaire ne correspond à cette sélection" });
    }

    // Token aléatoire, change à chaque génération (jamais réutilisé) —
    // 24 octets = 48 caractères hex, collision pratiquement impossible.
    const token = crypto.randomBytes(24).toString("hex");

    const batch = await EmergencyResetBatch.create({
      token,
      validationField,
      targetType,
      volunteerIds: targetType === "VOLUNTEERS" ? volunteerIds : [],
      programId: targetType === "PROGRAM" ? programId : null,
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      createdBy: req.user?.id || null,
    });

    const missingDataCount = targetVolunteers.filter((v) => !hasFieldData(v, validationField)).length;

    res.status(201).json({
      batch,
      targetCount: targetVolunteers.length,
      missingDataCount,
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN : lister les lots -------------------- */
exports.listBatches = async (req, res, next) => {
  try {
    const batches = await EmergencyResetBatch.find().sort({ createdAt: -1 }).limit(100).lean();

    const programIds = [...new Set(batches.filter((b) => b.programId).map((b) => String(b.programId)))];
    let programTitleById = new Map();
    if (programIds.length > 0) {
      const Program = getVolunteerProgramModel();
      const programs = await Program.find({ _id: { $in: programIds } }).select("title");
      programTitleById = new Map(programs.map((p) => [String(p._id), p.title]));
    }

    const items = await Promise.all(batches.map(async (b) => {
      const targetVolunteers = await resolveTargetVolunteers(b.targetType, { volunteerIds: b.volunteerIds, programId: b.programId });
      return {
        _id: b._id,
        token: b.token,
        validationField: b.validationField,
        targetType: b.targetType,
        programTitle: b.programId ? (programTitleById.get(String(b.programId)) || "?") : null,
        targetCount: targetVolunteers.length,
        usedCount: (b.usedByVolunteerIds || []).length,
        expiresAt: b.expiresAt,
        isExpired: new Date(b.expiresAt) <= new Date(),
        active: b.active,
        createdAt: b.createdAt,
      };
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN : désactiver un lot par anticipation -------------------- */
exports.deactivateBatch = async (req, res, next) => {
  try {
    const batch = await EmergencyResetBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: "Lot introuvable" });
    batch.active = false;
    await batch.save();
    res.json({ message: "Mesure d'urgence désactivée pour ce lot" });
  } catch (error) {
    next(error);
  }
};

/* ==================== PUBLIC ==================== */

async function findValidBatch(token) {
  const batch = await EmergencyResetBatch.findOne({ token });
  if (!batch) return null;
  if (!batch.active) return null;
  if (new Date(batch.expiresAt) <= new Date()) return null;
  return batch;
}

/* -------------------- Public : le lien est-il encore valide ? -------------------- */
exports.checkLink = async (req, res, next) => {
  try {
    const batch = await findValidBatch(req.params.token);
    if (!batch) return res.status(410).json({ message: "Ce lien de réinitialisation d'urgence est invalide ou a expiré." });
    res.json({ valid: true, validationField: batch.validationField, fieldLabel: FIELD_LABELS[batch.validationField] });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : vérifier l'identité (sans changer le mot de passe) -------------------- */
exports.verifyIdentity = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { email, answer } = req.body;
    if (!email || !answer) return res.status(400).json({ message: "Email et réponse requis" });

    const batch = await findValidBatch(token);
    if (!batch) return res.status(410).json({ message: "Ce lien de réinitialisation d'urgence est invalide ou a expiré." });

    const rateLimitKey = `${token}:${email.toLowerCase().trim()}`;
    if (loginAttemptLimiter.isLocked("emergency-reset", rateLimitKey)) {
      return res.status(429).json({ message: "Trop de tentatives. Réessayez dans quelques minutes." });
    }

    const volunteer = await Volunteer.findOne({ email: email.toLowerCase().trim() });
    if (!volunteer || !(await isVolunteerInBatchScope(batch, volunteer))) {
      loginAttemptLimiter.recordFailedAttempt("emergency-reset", rateLimitKey);
      return res.status(400).json({ message: "Aucun compte correspondant à cet email n'est concerné par cette mesure." });
    }

    if (batch.usedByVolunteerIds.some((id) => id.toString() === volunteer._id.toString())) {
      return res.status(409).json({ message: "Ce compte a déjà utilisé ce lien pour réinitialiser son mot de passe." });
    }

    if (!compareAnswer(volunteer, batch.validationField, answer)) {
      loginAttemptLimiter.recordFailedAttempt("emergency-reset", rateLimitKey);
      return res.status(400).json({ message: "Réponse incorrecte." });
    }

    loginAttemptLimiter.resetAttempts("emergency-reset", rateLimitKey);
    res.json({ valid: true });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Public : vérifier l'identité ET définir le nouveau mot de passe -------------------- */
/* Revalide tout (batch actif, email dans le périmètre, pas déjà utilisé,
   réponse correcte) plutôt que de faire confiance à un précédent appel à
   verifyIdentity — reste sans état entre les deux écrans, pas de session
   temporaire à gérer. */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { email, answer, newPassword } = req.body;
    if (!email || !answer || !newPassword) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
    }

    const batch = await findValidBatch(token);
    if (!batch) return res.status(410).json({ message: "Ce lien de réinitialisation d'urgence est invalide ou a expiré." });

    const rateLimitKey = `${token}:${email.toLowerCase().trim()}`;
    if (loginAttemptLimiter.isLocked("emergency-reset", rateLimitKey)) {
      return res.status(429).json({ message: "Trop de tentatives. Réessayez dans quelques minutes." });
    }

    const volunteer = await Volunteer.findOne({ email: email.toLowerCase().trim() });
    if (!volunteer || !(await isVolunteerInBatchScope(batch, volunteer))) {
      loginAttemptLimiter.recordFailedAttempt("emergency-reset", rateLimitKey);
      return res.status(400).json({ message: "Aucun compte correspondant à cet email n'est concerné par cette mesure." });
    }

    if (batch.usedByVolunteerIds.some((id) => id.toString() === volunteer._id.toString())) {
      return res.status(409).json({ message: "Ce compte a déjà utilisé ce lien pour réinitialiser son mot de passe." });
    }

    if (!compareAnswer(volunteer, batch.validationField, answer)) {
      loginAttemptLimiter.recordFailedAttempt("emergency-reset", rateLimitKey);
      return res.status(400).json({ message: "Réponse incorrecte." });
    }

    loginAttemptLimiter.resetAttempts("emergency-reset", rateLimitKey);

    volunteer.password = newPassword;
    // Un compte suspendu/désactivé ne doit pas se retrouver réactivé en
    // douce par cette mesure — la réinitialisation change le mot de passe,
    // rien d'autre. Les liens de réinitialisation classiques restent en
    // place (non touchés) pour ne pas casser une demande en cours.
    await volunteer.save();

    // Usage unique PAR COMPTE : ce volontaire ne peut plus réutiliser CE
    // lot, mais le lien reste actif pour les autres volontaires visés
    // jusqu'à expiration ou désactivation manuelle par l'ADMIN.
    batch.usedByVolunteerIds.push(volunteer._id);
    await batch.save();

    res.json({ message: "Mot de passe réinitialisé avec succès. Vous pouvez vous connecter." });
  } catch (error) {
    next(error);
  }
};
