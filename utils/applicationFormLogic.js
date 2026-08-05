/**
 * Logique de formulaire de candidature (façon Google Form), partagée entre
 * tous les systèmes "programme + candidature" de ce backend (NumSAL,
 * programmes de volontariat AMP Bénin). Extrait de
 * controllers/numsal/courseController.js.
 *
 * Paramétrée par la liste des champs "système" verrouillés de chaque
 * système plutôt que codée en dur, car ils diffèrent : NumSAL utilise un
 * `applicantName` unique, les programmes de volontariat utilisent
 * `applicantFirstName`/`applicantLastName` séparés (pour coller au modèle
 * Volunteer existant, qui a nom/prénom séparés).
 */

const CONDITIONAL_TRIGGER_TYPES = ["SELECT", "CHECKBOX"];

/* Injecte les champs "système" manquants en tête de liste — utile pour les
   programmes créés avant l'introduction d'un nouveau champ verrouillé (pas
   de script de migration nécessaire, cohérent avec la façon dont ce projet
   gère déjà les nouveaux champs de schéma via les valeurs par défaut
   Mongoose). */
const ensureBuiltinFields = (fields, builtinFields) => {
  const existingIds = new Set((fields || []).map((f) => f.id));
  const missing = builtinFields.filter((f) => !existingIds.has(f.id));
  return missing.length ? [...missing, ...(fields || [])] : fields || [];
};

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
   candidat) : ids uniques, champs verrouillés présents/corrects, pas
   d'auto-référence, déclencheur d'un type autorisé, valeurs déclenchantes
   non vides, pas de boucle de dépendance (garantie structurellement par la
   contrainte de position : un déclencheur doit toujours précéder son
   sous-champ). `lockedBuiltinFields` fournit à la fois le type attendu et le
   libellé à utiliser dans les messages d'erreur pour chaque champ verrouillé. */
const validateFormFieldsDefinition = (fields, lockedBuiltinFields) => {
  const ids = new Set();
  for (const f of fields) {
    if (!f.id || !f.label || !f.type) {
      return "Chaque champ doit avoir un identifiant, un libellé et un type";
    }
    if (ids.has(f.id)) return `Identifiant de champ dupliqué : ${f.id}`;
    ids.add(f.id);
  }

  for (const builtin of lockedBuiltinFields) {
    const field = fields.find((f) => f.id === builtin.id);
    if (!field) {
      return `Le champ "${builtin.label}" est indispensable et ne peut pas être supprimé`;
    }
    if (field.type !== builtin.type) {
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

/* `responses` doit ici déjà inclure les champs verrouillés fusionnés (voir
   le contrôleur appelant) — ils sont envoyés en paramètres de premier niveau
   par l'assistant candidat, pas dans son objet `responses` brut, qu'ils
   soient verrouillés ou non. */
const validateApplicationResponses = (fields, responses) => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const field of fields) {
    if (!isFieldVisible(field, responses, fieldsById)) continue;

    const value = responses?.[field.id];
    // IMAGE : la valeur est un tableau d'URLs Cloudinary — "vide" veut dire
    // tableau absent/vide, pas une simple valeur falsy (un tableau est
    // toujours "truthy" en JS).
    const isEmpty = field.type === "IMAGE"
      ? !Array.isArray(value) || value.length === 0
      : value === undefined || value === null || value === "";

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
          // pattern invalide côté gestionnaire du programme : ignoré plutôt que de bloquer le candidat
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

    if (field.type === "URL" && !/^https?:\/\/.+/i.test(String(value))) {
      return `"${field.label}" doit être un lien valide (commençant par http:// ou https://)`;
    }

    if (field.type === "IMAGE") {
      if (!Array.isArray(value) || !value.every((url) => typeof url === "string" && url)) {
        return `"${field.label}" doit être une liste de photos valides`;
      }
      if (v.maxImages && value.length > v.maxImages) {
        return `"${field.label}" accepte au maximum ${v.maxImages} photo(s)`;
      }
    }
  }
  return null;
};

module.exports = {
  CONDITIONAL_TRIGGER_TYPES,
  ensureBuiltinFields,
  isFieldVisible,
  validateFormFieldsDefinition,
  validateApplicationResponses,
};
