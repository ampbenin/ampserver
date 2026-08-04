/**
 * Script de migration ponctuelle : ancien système de volontariat
 * (Mission + VolunteerForm + Volunteer.missions[]) → nouveau système façon
 * NumSAL (VolunteerProgram + VolunteerApplication + VolunteerFormTemplate +
 * Volunteer.programs[]). Voir le plan de migration pour le détail complet.
 *
 * NE SUPPRIME RIEN des anciennes collections (Mission, VolunteerForm) — se
 * contente d'ajouter/mettre à jour. Par défaut tourne en mode LECTURE SEULE
 * (dry-run) : il faut explicitement passer --write pour persister quoi que
 * ce soit. Toujours lancer d'abord SANS --write pour vérifier le rapport.
 *
 * Usage :
 *   node scripts/migrateVolunteerPrograms.js            (dry-run, rien n'est écrit)
 *   node scripts/migrateVolunteerPrograms.js --write     (écriture réelle)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const Mission = require("../models/mission");
const VolunteerForm = require("../models/volunteerForm");
const Volunteer = require("../models/volunteer");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getVolunteerFormTemplateModel = require("../models/volunteerFormTemplate");

const WRITE = process.argv.includes("--write");

/* -------------------- Champs du formulaire volontaire historique -------------------- */
/* Reconstruit depuis pages/volontaires.astro (l'ancien formulaire générique
   unique) — devient le modèle "candidature spontanée" par défaut, ET le
   applicationForm.fields de chaque programme migré depuis Mission (aucune
   fiche Mission n'avait de formulaire propre : on leur donne celui-ci pour
   ne perdre aucune capacité de collecte). */
const HISTORICAL_FIELDS = [
  { id: "birthDate", label: "Quelle est votre date de naissance ?", type: "DATE", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "gender", label: "Genre", type: "SELECT", required: true, locked: false, options: ["Homme", "Femme", "Autre"], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "otherGender", label: "Veuillez préciser votre genre", type: "TEXT", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "gender", values: ["Autre"] } },
  { id: "country", label: "Pays", type: "SELECT", required: true, locked: false, options: ["Bénin", "Togo", "Nigeria", "France", "Autre"], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "otherCountry", label: "Veuillez préciser votre pays", type: "TEXT", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "country", values: ["Autre"] } },
  { id: "city", label: "Ville / Commune", type: "TEXT", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "mainSkill", label: "Compétence principale", type: "TEXT", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "sensitiveTopic", label: "Thématique sensible", type: "SELECT", required: true, locked: false, options: ["VBG", "Environnement", "Santé", "Jeunesse", "Numérique", "Autre"], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "otherTopic", label: "Veuillez préciser la thématique", type: "TEXT", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "sensitiveTopic", values: ["Autre"] } },
  { id: "desiredDomain", label: "Domaine souhaité", type: "SELECT", required: true, locked: false, options: ["Sensibilisation", "Communication", "Logistique", "Événementiel", "Autres"], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "otherDomain", label: "Veuillez préciser le domaine", type: "TEXT", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "desiredDomain", values: ["Autres"] } },
  { id: "motivation", label: "Pourquoi souhaitez-vous devenir volontaire ?", type: "TEXTAREA", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "availability", label: "Disponibilité", type: "SELECT", required: true, locked: false, options: ["Semaine", "Week-end", "Occasionnel"], validation: {}, conditional: { fieldId: "", values: [] } },
  { id: "agreement", label: "J'accepte de devenir volontaire et je certifie que les informations sont exactes.", type: "CHECKBOX", required: true, locked: false, options: [], validation: {}, conditional: { fieldId: "", values: [] } },
];

// Sépare un nom complet ("Jean Dupont Kokou") en prénom/nom pour coller au
// nouveau schéma applicantFirstName/applicantLastName — même limite connue
// que l'ancien système (pas de séparation fiable), mais acceptable pour une
// migration ponctuelle de données historiques : chaque cas est journalisé
// dans le rapport pour vérification manuelle si besoin.
function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length === 0 || (parts.length === 1 && !parts[0])) return { firstName: "Inconnu", lastName: "Inconnu" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function migrate() {
  await connectDB();
  // formDB (createConnection) bufferise les commandes tant qu'elle n'est
  // pas connectée : pas besoin d'attendre explicitement son event "connected".

  console.log(`\n=== Migration volontariat AMP BÉNIN — mode ${WRITE ? "ÉCRITURE RÉELLE" : "LECTURE SEULE (dry-run)"} ===\n`);

  const report = {
    templateCreated: false,
    missionsSeen: 0,
    programsCreated: 0,
    formsSeen: 0,
    applicationsCreated: 0,
    applicationsSkippedDuplicate: [],
    volunteersSeen: 0,
    volunteersUpdated: 0,
    unmappedProgramRefs: [],
  };

  /* -------------------- Étape 0 : modèle "candidature spontanée" -------------------- */
  const FormTemplate = getVolunteerFormTemplateModel();
  let spontaneousTemplate = await FormTemplate.findOne({ isSpontaneousDefault: true });
  if (!spontaneousTemplate) {
    console.log("→ Aucun modèle spontané existant : création du modèle historique.");
    if (WRITE) {
      spontaneousTemplate = await FormTemplate.create({
        name: "Formulaire volontaire historique",
        fields: HISTORICAL_FIELDS,
        isSpontaneousDefault: true,
      });
      report.templateCreated = true;
    }
  } else {
    console.log("→ Un modèle spontané existe déjà — conservé tel quel.");
  }

  /* -------------------- Étape 1 : Mission → VolunteerProgram -------------------- */
  const Program = getVolunteerProgramModel();
  const missions = await Mission.find().lean();
  report.missionsSeen = missions.length;
  const missionIdMap = new Map(); // ancien Mission._id (string) → nouveau VolunteerProgram._id (ObjectId)
  const now = new Date();

  for (const m of missions) {
    const isPast = m.dateFin && new Date(m.dateFin) < now;
    const programData = {
      title: m.titre,
      description: m.description || "",
      location: m.lieu || "",
      startDate: m.dateDebut || null,
      endDate: m.dateFin || null,
      status: isPast ? "CLOSED" : "PUBLISHED",
      accessMode: "APPLICATION",
      applicationForm: { fields: HISTORICAL_FIELDS, estimatedDuration: "" },
    };

    console.log(`  Mission "${m.titre}" (${m._id}) → VolunteerProgram [${programData.status}]`);

    if (WRITE) {
      const created = await Program.create(programData);
      missionIdMap.set(String(m._id), created._id);
      report.programsCreated++;
    } else {
      // En dry-run on ne peut pas connaître le futur _id : on utilise
      // l'ancien id comme placeholder pour que le reste du rapport reste lisible.
      missionIdMap.set(String(m._id), m._id);
    }
  }

  /* -------------------- Étape 2 : VolunteerForm → VolunteerApplication -------------------- */
  const Application = getVolunteerApplicationModel();
  const forms = await VolunteerForm.find().lean();
  report.formsSeen = forms.length;

  for (const f of forms) {
    const { firstName, lastName } = splitFullName(f.fullName);
    const responses = {
      birthDate: f.birthDate,
      gender: f.gender,
      otherGender: f.otherGender || "",
      country: f.country,
      otherCountry: f.otherCountry || "",
      city: f.city,
      mainSkill: f.mainSkill,
      sensitiveTopic: f.sensitiveTopic,
      otherTopic: f.otherTopic || "",
      desiredDomain: f.desiredDomain,
      otherDomain: f.otherDomain || "",
      motivation: f.motivation,
      availability: f.availability,
      agreement: !!f.agreement,
    };
    const status = f.status === "approved" ? "ACCEPTED" : "PENDING";

    console.log(`  VolunteerForm "${f.fullName}" <${f.email}> → VolunteerApplication [${status}]`);

    if (WRITE) {
      try {
        const created = await Application.create({
          programId: null,
          applicantFirstName: firstName,
          applicantLastName: lastName,
          applicantEmail: f.email,
          applicantPhone: f.phone || "",
          responses,
          status,
          reviewedBy: f.handledBy || null,
          reviewedAt: f.handledAt || null,
        });
        // Préserve la date de soumission d'origine (le schéma {timestamps:true}
        // aurait sinon écrasé createdAt à "maintenant" lors du .create()).
        await Application.updateOne(
          { _id: created._id },
          { $set: { createdAt: f.createdAt || now, updatedAt: f.createdAt || now } },
          { timestamps: false }
        );
        report.applicationsCreated++;
      } catch (err) {
        if (err.code === 11000) {
          report.applicationsSkippedDuplicate.push(f.email);
        } else {
          throw err;
        }
      }
    }
  }

  /* -------------------- Étape 3 : Volunteer.missions[] → Volunteer.programs[] -------------------- */
  // Manipulation directe de la collection Mongo brute (bypass du schéma
  // Mongoose, qui attend déjà le NOUVEAU nom de champs) : les documents
  // existants en base portent encore les anciens noms missions/missionId.
  const rawColl = Volunteer.collection;
  const volunteerDocs = await rawColl.find({ $or: [{ missions: { $exists: true } }, { attestations: { $exists: true } }] }).toArray();
  report.volunteersSeen = volunteerDocs.length;

  for (const doc of volunteerDocs) {
    const mapProgramId = (oldId, context) => {
      const key = String(oldId);
      if (missionIdMap.has(key)) return missionIdMap.get(key);
      report.unmappedProgramRefs.push({ email: doc.email, oldMissionId: key, context });
      return oldId; // on ne perd pas la donnée : on garde l'ancien id tel quel
    };

    const programs = (doc.missions || []).map((m) => ({
      programId: mapProgramId(m.missionId, "programs"),
      statut: m.statut || "Non disponible",
      assignedAt: m.assignedAt || doc.createdAt || now,
    }));

    const attestations = (doc.attestations || []).map((a) => ({
      programId: mapProgramId(a.missionId, "attestations"),
      programName: a.missionName || null,
      fileName: a.fileName || null,
      fileUrl: a.fileUrl || null,
      statut: a.statut || "Non disponible",
      uploadedAt: a.uploadedAt || now,
    }));

    console.log(`  Volunteer <${doc.email}> : ${programs.length} programme(s), ${attestations.length} attestation(s)`);

    if (WRITE) {
      await rawColl.updateOne(
        { _id: doc._id },
        { $set: { programs, attestations }, $unset: { missions: "" } }
      );
      report.volunteersUpdated++;
    }
  }

  /* -------------------- Rapport final -------------------- */
  console.log("\n=== Rapport ===");
  console.log(`Modèle spontané      : ${report.templateCreated ? "créé" : "déjà présent / non créé (dry-run)"}`);
  console.log(`Missions vues        : ${report.missionsSeen}${WRITE ? ` (→ ${report.programsCreated} programmes créés)` : " (dry-run : rien créé)"}`);
  console.log(`VolunteerForm vus    : ${report.formsSeen}${WRITE ? ` (→ ${report.applicationsCreated} candidatures créées)` : " (dry-run : rien créé)"}`);
  if (report.applicationsSkippedDuplicate.length > 0) {
    console.log(`  ⚠️ Ignorés (email déjà candidat spontané) : ${report.applicationsSkippedDuplicate.join(", ")}`);
  }
  console.log(`Volontaires vus      : ${report.volunteersSeen}${WRITE ? ` (→ ${report.volunteersUpdated} mis à jour)` : " (dry-run : rien modifié)"}`);
  if (report.unmappedProgramRefs.length > 0) {
    console.log(`  ⚠️ Références de programme non résolues (id Mission introuvable) :`);
    report.unmappedProgramRefs.forEach((r) => console.log(`     - ${r.email} / ${r.context} / ancien id ${r.oldMissionId}`));
  }
  console.log(WRITE
    ? "\n✅ Migration écrite. Les anciennes collections Mission/VolunteerForm sont conservées intactes."
    : "\n→ Dry-run terminé, rien n'a été écrit. Relancer avec --write pour appliquer.");

  await mongoose.disconnect();
  if (global.formDB) await global.formDB.close();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ ERREUR MIGRATION :", err);
  process.exit(1);
});
