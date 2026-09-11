const Volunteer = require("../models/volunteer");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const { canReviewProgram } = require("./volunteerProgramController");
const cloudinary = require("../utils/cloudinary");
const { generateCertificateImage } = require("../utils/certificateGenerator");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");
const streamifier = require("streamifier");

// Même pattern que volunteerAuthController.js / volunteerApplicationController.js
// / gestionamp/authController.js : domaine du frontend configurable via
// FRONTEND_URL, secours sur le domaine propre ampbenin.org (nom de domaine
// personnalisé branché sur Netlify, 2026-09-10 — remplace l'ancien
// sous-domaine ampbenin.netlify.app utilisé partout avant ça).
const FRONTEND_BASE = process.env.FRONTEND_URL || "https://ampbenin.org";

/* Refondu le 2026-08-19 (raisonne par programId, autorisation via
   canReviewProgram) puis à nouveau le 2026-09-10 (décision utilisateur) :
   remplace le fond dessiné par code (identique pour tous les programmes,
   voir git history) par un système de VISUEL PAR PROGRAMME + zones
   positionnables (QR / nom / description), même principe que les "types de
   tickets" de server-miss-culture-benin — voir utils/certificateGenerator.js
   pour la technique de superposition, et VolunteerProgram (certificateTemplateUrl
   / certificateZones / certificateDescription) pour les champs.
   Le résultat reste un vrai PDF (1 page, embarquant l'image composite) :
   voir renderCertificatePdf ci-dessous. Un programme sans visuel configuré
   ne peut plus générer de certificat (pas de repli automatique, décision
   utilisateur) — voir la vérification dans generateCertificate. */

/* -------------------- Staff : volontaires éligibles + déjà générés pour un programme -------------------- */
const fetchVolunteersForCertificate = async (req, res) => {
  try {
    const { programId } = req.params;
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select(
      "title reviewerIds editorIds certificateTemplateUrl"
    );
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const volunteers = await Volunteer.find({ "programs.programId": program._id }).lean();

    const eligible = [];
    const alreadyGenerated = [];
    volunteers.forEach((v) => {
      const programData = v.programs.find((p) => p.programId.toString() === program._id.toString());
      if (programData?.statut !== "Mission validée") return;

      const existing = v.attestations?.find((a) => a.programId.toString() === program._id.toString());
      const summary = { volunteerId: v._id, nom: v.nom, prenom: v.prenom, email: v.email, telephone: v.telephone };
      if (existing?.fileUrl) {
        alreadyGenerated.push({
          ...summary,
          fileUrl: existing.fileUrl,
          fileName: existing.fileName,
          uploadedAt: existing.uploadedAt,
          visibleToVolunteer: existing.visibleToVolunteer !== false,
        });
      } else {
        eligible.push(summary);
      }
    });

    res.status(200).json({
      programTitle: program.title,
      hasTemplate: !!program.certificateTemplateUrl,
      eligible,
      alreadyGenerated,
    });
  } catch (error) {
    console.error("❌ fetchVolunteersForCertificate erreur :", error);
    res.status(500).json({ message: error.message || "Erreur serveur" });
  }
};

/* -------------------- Upload du visuel de certificat (+ zones + description) d'un programme -------------------- */
// multipart/form-data : file (SVG/PNG/JPG), zones (JSON string), certificateDescription
const ALLOWED_TEMPLATE_MIMETYPES = ["image/svg+xml", "image/png", "image/jpeg"];

function templateFormatFor(mimetype) {
  return mimetype === "image/svg+xml" ? "svg" : "raster";
}

function uploadTemplateBuffer(buffer, mimetype) {
  const isSvg = mimetype === "image/svg+xml";
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      isSvg
        ? { folder: "ong-site/certificate-templates", resource_type: "raw", format: "svg" }
        : { folder: "ong-site/certificate-templates", resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

function destroyTemplateAsset(publicId, templateFormat) {
  if (!publicId) return Promise.resolve();
  return cloudinary.uploader
    .destroy(publicId, { resource_type: templateFormat === "raster" ? "image" : "raw" })
    .catch((err) => console.error("⚠️ destroyTemplateAsset (certificat) erreur :", err.message));
}

function parseZones(rawZones) {
  if (!rawZones) return [];
  const zones = typeof rawZones === "string" ? JSON.parse(rawZones) : rawZones;
  if (!Array.isArray(zones)) throw new Error("zones doit être un tableau");
  return zones.map((z) => ({
    nom: String(z.nom),
    x: Number(z.x),
    y: Number(z.y),
    width: Number(z.width),
    height: Number(z.height),
    fontSize: z.fontSize != null ? Number(z.fontSize) : 24,
    color: z.color || "#000000",
  }));
}

const uploadCertificateTemplate = async (req, res) => {
  try {
    const { programId } = req.params;
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select(
      "title reviewerIds editorIds certificateTemplateUrl certificateTemplatePublicId certificateTemplateFormat"
    );
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    // Le fichier n'est requis QUE s'il n'y a pas encore de visuel enregistré
    // — une fois un visuel en place, on doit pouvoir mettre à jour juste les
    // zones et/ou la description (ex : ajuster le texte) sans redemander de
    // réuploader l'image à chaque fois.
    if (!req.file && !program.certificateTemplateUrl) {
      return res.status(400).json({ message: "Le fichier du visuel (SVG, PNG ou JPG) est requis" });
    }
    if (req.file && !ALLOWED_TEMPLATE_MIMETYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ message: "Format de fichier non supporté (SVG, PNG ou JPG uniquement)" });
    }

    let zones;
    try {
      zones = parseZones(req.body.zones);
    } catch (e) {
      return res.status(400).json({ message: e.message });
    }

    if (req.file) {
      const oldPublicId = program.certificateTemplatePublicId;
      const oldFormat = program.certificateTemplateFormat;

      const uploaded = await uploadTemplateBuffer(req.file.buffer, req.file.mimetype);

      program.certificateTemplateUrl = uploaded.secure_url;
      program.certificateTemplatePublicId = uploaded.public_id;
      program.certificateTemplateFormat = templateFormatFor(req.file.mimetype);

      // Best-effort : ne bloque jamais la mise à jour si le nettoyage échoue.
      if (oldPublicId) destroyTemplateAsset(oldPublicId, oldFormat);
    }

    program.certificateZones = zones;
    if (req.body.certificateDescription !== undefined) {
      program.certificateDescription = req.body.certificateDescription;
    }
    await program.save();

    res.json({
      message: "Visuel de certificat mis à jour",
      certificateTemplateUrl: program.certificateTemplateUrl,
      certificateTemplateFormat: program.certificateTemplateFormat,
      certificateZones: program.certificateZones,
      certificateDescription: program.certificateDescription,
    });
  } catch (error) {
    console.error("❌ uploadCertificateTemplate erreur :", error);
    res.status(500).json({ message: error.message || "Erreur serveur" });
  }
};

/* -------------------- Rendu PDF d'un certificat (1 page, image composite embarquée) -------------------- */
async function renderCertificatePdf({ program, volunteerName, description, qrUrl }) {
  const pngBuffer = await generateCertificateImage(program, volunteerName, description, qrUrl);
  const { width, height } = await sharp(pngBuffer).metadata();

  // Page dimensionnée à la largeur d'une A4 paysage classique (842pt),
  // hauteur déduite du ratio réel du visuel fourni — quel que soit son
  // format d'origine, le certificat reste plein cadre, jamais déformé ni
  // avec des bandes vides.
  const PAGE_W = 842;
  const PAGE_H = (height / width) * PAGE_W;

  const pdfDoc = await PDFDocument.create();
  const image = await pdfDoc.embedPng(pngBuffer);
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  page.drawImage(image, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  return pdfDoc.save();
}

// Nom de fichier lisible pour le PDF téléchargé — demande explicite :
// "<Prénom Nom> <10 premières lettres du titre de la mission> AMP BENIN"
// (au lieu du nom aléatoire généré par Cloudinary).
//
// ⚠️ IMPORTANT (testé en direct sur ce compte Cloudinary, 2026-09-10) : le
// compte a la restriction de sécurité "Restricted media types" active, qui
// bloque (401) toute livraison "raw" dès que ".pdf" apparaît N'IMPORTE OÙ
// dans l'URL demandée — public_id, ET même le nom suggéré via le flag
// fl_attachment (testé aussi : 400 Bad Request). Impossible à contourner en
// code tant que ce réglage reste actif (Console Cloudinary → Settings →
// Security → "Restricted media types" / "Allow delivery of PDF and ZIP
// files" — à activer manuellement pour lever complètement cette limite).
// En attendant : le fichier est stocké SANS extension dans son public_id
// (seule façon de rester livrable), et le nom lisible est appliqué à la
// volée au moment du téléchargement via fl_attachment (SANS ".pdf" dedans,
// pour ne pas retomber dans le blocage) — voir buildDownloadUrl.
function sanitizeForFilename(str) {
  return String(str || "")
    .replace(/[\/\\?%*:|"<>.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function buildAttestationFilename(volunteerName, programTitle) {
  const missionPrefix = sanitizeForFilename(programTitle).slice(0, 10).trim();
  return `${sanitizeForFilename(volunteerName)} ${missionPrefix} AMP BENIN`;
}
function buildDownloadUrl(publicId, version, filename) {
  return cloudinary.url(publicId, {
    resource_type: "raw",
    type: "upload",
    version,
    flags: `attachment:${filename}`,
  });
}

const uploadFromBuffer = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "raw" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

const generateCertificate = async (req, res) => {
  try {
    const { programId } = req.params;
    // volunteerIds optionnel (mêmes conventions que reactivateFinalReport,
    // volunteerTaskController.js) : absent/vide = tous les éligibles.
    const { volunteerIds } = req.body || {};

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select(
      "title reviewerIds editorIds certificateTemplateUrl certificateTemplateFormat certificateZones certificateDescription"
    );
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }
    if (!program.certificateTemplateUrl) {
      return res.status(400).json({
        message: "Il faut d'abord importer un visuel de certificat pour ce programme avant de pouvoir en générer.",
      });
    }

    const volunteerQuery = { "programs.programId": program._id };
    if (Array.isArray(volunteerIds) && volunteerIds.length > 0) {
      volunteerQuery._id = { $in: volunteerIds };
    }
    let volunteers = await Volunteer.find(volunteerQuery);

    // Filtrer : mission validée pour CE programme et pas déjà d'attestation.
    volunteers = volunteers.filter((v) => {
      const p = v.programs.find(
        (p) =>
          p.programId.toString() === program._id.toString() &&
          p.statut === "Mission validée"
      );
      const alreadyGenerated = v.attestations?.some(
        (a) => a.programId.toString() === program._id.toString()
      );
      return p && !alreadyGenerated;
    });

    if (volunteers.length === 0)
      return res.status(404).json({ message: "Aucun volontaire éligible trouvé" });

    let generatedCount = 0;

    for (const volunteer of volunteers) {
      // Créer une attestation vide pour générer l'ID (le QR encode cet ID,
      // voir verifyAttestation — il faut donc l'ID AVANT de dessiner le PDF).
      volunteer.attestations.push({
        programId: program._id,
        programName: program.title,
        statut: "Mission validée",
      });
      await volunteer.save();

      const attestation = volunteer.attestations[volunteer.attestations.length - 1];
      const attestationId = attestation._id.toString();

      const pdfBytes = await renderCertificatePdf({
        program,
        volunteerName: `${volunteer.prenom} ${volunteer.nom}`,
        description: program.certificateDescription,
        qrUrl: `${FRONTEND_BASE}/verify/${attestationId}`,
      });

      // Dossier nommé par l'ID de l'attestation : garantit l'unicité côté
      // Cloudinary (deux volontaires homonymes sur la même mission
      // n'écrasent pas le fichier l'un de l'autre).
      const filename = buildAttestationFilename(`${volunteer.prenom} ${volunteer.nom}`, program.title);
      const uploadedFile = await uploadFromBuffer(Buffer.from(pdfBytes), `attestations/${attestationId}`);

      attestation.fileUrl = buildDownloadUrl(uploadedFile.public_id, uploadedFile.version, filename);
      attestation.fileName = `${filename}.pdf`;
      attestation.uploadedAt = new Date();
      await volunteer.save();

      generatedCount++;
    }

    res.status(200).json({
      message: "Batch terminé",
      generated: generatedCount,
      total: volunteers.length,
      programTitle: program.title,
    });
  } catch (error) {
    console.error("❌ generateCertificate erreur :", error);
    res.status(500).json({ message: error.message });
  }
};

/* -------------------- Staff : réinitialiser l'attestation d'un/plusieurs volontaires (pour pouvoir la régénérer) -------------------- */
// Demandé le 2026-09-10 : après le correctif du bug de police cassée en
// production, certaines attestations déjà générées ont un PDF illisible —
// il faut pouvoir les "nettoyer" pour que le volontaire redevienne éligible
// et qu'on puisse relancer la génération, sans devoir toucher la base
// manuellement. Retire juste l'entrée `attestations` correspondant à ce
// programme (le volontaire réapparaît alors dans la liste des éligibles).
// Le fichier PDF déjà uploadé sur Cloudinary n'est PAS supprimé (son
// public_id n'est pas conservé sur l'attestation, seulement fileUrl) — reste
// orphelin sur Cloudinary, sans conséquence fonctionnelle.
const resetCertificates = async (req, res) => {
  try {
    const { programId } = req.params;
    const { volunteerIds } = req.body || {};
    if (!Array.isArray(volunteerIds) || volunteerIds.length === 0) {
      return res.status(400).json({ message: "volunteerIds requis (au moins un volontaire)" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title reviewerIds editorIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const volunteers = await Volunteer.find({
      _id: { $in: volunteerIds },
      "attestations.programId": program._id,
    });

    let resetCount = 0;
    for (const volunteer of volunteers) {
      const before = volunteer.attestations.length;
      volunteer.attestations = volunteer.attestations.filter(
        (a) => a.programId.toString() !== program._id.toString()
      );
      if (volunteer.attestations.length !== before) {
        await volunteer.save();
        resetCount++;
      }
    }

    res.status(200).json({ message: "Attestations réinitialisées", reset: resetCount });
  } catch (error) {
    console.error("❌ resetCertificates erreur :", error);
    res.status(500).json({ message: error.message || "Erreur serveur" });
  }
};

/* -------------------- Staff : activer/désactiver la visibilité d'une attestation dans "Mon espace" -------------------- */
// Demandé le 2026-09-11 : une attestation générée est immédiatement
// visible/téléchargeable dans l'espace du volontaire — on veut pouvoir la
// masquer (sans la supprimer, contrairement à /reset) pour certains
// volontaires, en sélection individuelle ou groupée ("tout sélectionner").
// `visible` détermine l'action pour TOUS les volunteerIds donnés en un seul
// appel (pas de mélange activer/désactiver dans le même appel — l'UI fait
// deux boutons distincts plutôt qu'un état par ligne à combiner).
const setCertificateVisibility = async (req, res) => {
  try {
    const { programId } = req.params;
    const { volunteerIds, visible } = req.body || {};
    if (!Array.isArray(volunteerIds) || volunteerIds.length === 0) {
      return res.status(400).json({ message: "volunteerIds requis (au moins un volontaire)" });
    }
    if (typeof visible !== "boolean") {
      return res.status(400).json({ message: "visible (booléen) requis" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title reviewerIds editorIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
    }

    const volunteers = await Volunteer.find({
      _id: { $in: volunteerIds },
      "attestations.programId": program._id,
    });

    let updatedCount = 0;
    for (const volunteer of volunteers) {
      const attestation = volunteer.attestations.find((a) => a.programId.toString() === program._id.toString());
      if (attestation && attestation.visibleToVolunteer !== visible) {
        attestation.visibleToVolunteer = visible;
        await volunteer.save();
        updatedCount++;
      }
    }

    res.status(200).json({ message: "Visibilité mise à jour", updated: updatedCount });
  } catch (error) {
    console.error("❌ setCertificateVisibility erreur :", error);
    res.status(500).json({ message: error.message || "Erreur serveur" });
  }
};

/* -------------------- Public : vérification d'une attestation via son ObjectId (scan QR) -------------------- */
const verifyAttestation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "ID de l'attestation manquant" });

    const volunteer = await Volunteer.findOne({ "attestations._id": id }).lean();
    if (!volunteer) return res.json({ error: true });

    const attestation = volunteer.attestations.find(a => a._id.toString() === id);
    if (!attestation) return res.json({ error: true });

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(attestation.programId).lean();
    if (!program) return res.json({ error: true });

    // ⚠️ Sécurité (2026-09-11) : cette route est PUBLIQUE (aucune
    // authentification — quiconque scanne le QR code, ou devine/partage ce
    // lien, y accède). fileUrl/fileName ont été retirés de la réponse :
    // n'importe qui pouvait télécharger l'attestation officielle d'un tiers,
    // ce n'est pas le rôle de cette page — elle sert UNIQUEMENT à confirmer
    // l'authenticité (nom/mission/date), pas à distribuer le PDF. Le
    // téléchargement reste possible pour le volontaire lui-même, depuis son
    // espace authentifié ("Mon espace").
    res.json({
      nom: volunteer.nom,
      prenom: volunteer.prenom,
      email: volunteer.email,
      telephone: volunteer.telephone,
      mission: program.title,
      date: attestation.uploadedAt || volunteer.updatedAt,
    });
  } catch (error) {
    console.error("❌ verifyAttestation erreur :", error);
    res.status(500).json({ error: true });
  }
};

module.exports = {
  fetchVolunteersForCertificate,
  uploadCertificateTemplate,
  generateCertificate,
  resetCertificates,
  setCertificateVisibility,
  verifyAttestation,
};
