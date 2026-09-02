const Volunteer = require("../models/volunteer");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const { canReviewProgram } = require("./volunteerProgramController");
const cloudinary = require("../utils/cloudinary");
const { PDFDocument } = require("pdf-lib");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const streamifier = require("streamifier");

/* Refondu le 2026-08-19 (décision utilisateur) : raisonne désormais par
   programId (comme le reste du chantier volontaires) plutôt que par titre
   de programme, et l'autorisation passe par canReviewProgram
   (volunteerProgramController.js — ADMIN toujours, EDITOR seulement si
   affecté à CE programme) au lieu d'un simple roleMiddleware ADMIN/EDITOR
   qui ne scopait à aucun programme précis. L'auto-service public
   (downloadCertificate, AttestationForm.jsx) a été supprimé : chaque
   volontaire a désormais son espace authentifié ("Mon espace" →
   Dashboard.jsx, section "Mes attestations", qui lit déjà
   profile.attestations via GET /api/volunteer-auth/me — voir
   attachProgramTitles dans volunteerController.js, inchangé). Seule
   verifyAttestation reste publique (scan du QR code sur l'attestation
   papier/PDF). VolunteerProgram vit sur global.formDB, Volunteer sur la
   connexion par défaut — pas de .populate() cross-connection possible,
   résolution manuelle comme partout ailleurs dans ce chantier. */

/* -------------------- Staff : volontaires éligibles + déjà générés pour un programme -------------------- */
const fetchVolunteersForCertificate = async (req, res) => {
  try {
    const { programId } = req.params;
    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title reviewerIds editorIds");
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
        alreadyGenerated.push({ ...summary, fileUrl: existing.fileUrl, uploadedAt: existing.uploadedAt });
      } else {
        eligible.push(summary);
      }
    });

    res.status(200).json({ programTitle: program.title, eligible, alreadyGenerated });
  } catch (error) {
    console.error("❌ fetchVolunteersForCertificate erreur :", error);
    res.status(500).json({ message: error.message || "Erreur serveur" });
  }
};

/* -------------------- Génération des certificats -------------------- */

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

// Convertir des coordonnées en cm en pixels selon le template
const cmToPx = (zoneCm, image) => {
  const pxPerCmX = image.width / 21; // largeur du template en cm
  const pxPerCmY = image.height / 29.7; // hauteur du template en cm (A4)
  return {
    x: zoneCm.x * pxPerCmX,
    y: zoneCm.y * pxPerCmY,
    width: zoneCm.width * pxPerCmX,
    height: zoneCm.height * pxPerCmY,
  };
};

// Zones converties à partir de l'ancien template
const ZONE_NAME_CM = { x: 3.85, y: 12.0, width: 13.07, height: 2.95 };
const ZONE_QR_CM = { x: 2.03, y: 22.21, width: 2.16, height: 4.35 };


function fitNameText(ctx, text, maxWidth, maxHeight, fontFamily, initialSize) {
  let fontSize = initialSize;
  do {
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (metrics.width <= maxWidth && textHeight <= maxHeight) break;
    fontSize--;
  } while (fontSize > 10);
  return ctx.font;
}

const generateCertificate = async (req, res) => {
  try {
    const { programId } = req.params;
    // volunteerIds optionnel (mêmes conventions que reactivateFinalReport,
    // volunteerTaskController.js) : absent/vide = tous les éligibles.
    const { volunteerIds } = req.body || {};

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title reviewerIds editorIds");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });
    if (!canReviewProgram(program, req.user)) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à gérer ce programme" });
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
      const programInfo = volunteer.programs.find(
        (p) => p.programId.toString() === program._id.toString()
      );

      // Créer une attestation vide pour générer l'ID
      volunteer.attestations.push({
        programId: program._id,
        programName: program.title,
        statut: programInfo.statut,
      });
      await volunteer.save();

      const attestation =
        volunteer.attestations[volunteer.attestations.length - 1];

      // Charger le template
      const templatePath = path.resolve(
        __dirname,
        "../assets/attestation_mycountr229_08_2025.jpg"
      );
      const templateBuffer = fs.readFileSync(templatePath);
      const templateImage = await loadImage(templateBuffer);

      // Redimensionner le canvas pour A4
      const maxWidth = 2480; // largeur A4 px
      const maxHeight = 3508; // hauteur A4 px
      const scaleX = maxWidth / templateImage.width;
      const scaleY = maxHeight / templateImage.height;
      const scale = Math.min(scaleX, scaleY);

      const canvas = createCanvas(
        templateImage.width * scale,
        templateImage.height * scale
      );
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        templateImage,
        0,
        0,
        canvas.width,
        canvas.height
      );

      /* -------------------- NOM & PRÉNOM -------------------- */
      const nameRect = cmToPx(ZONE_NAME_CM, canvas);
      const textNameX = nameRect.x + nameRect.width / 2;
      const textNameY = nameRect.y + nameRect.height / 2;

      ctx.fillStyle = "#190d86ff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fitNameText(
        ctx,
        `${volunteer.nom} ${volunteer.prenom}`,
        nameRect.width,
        nameRect.height,
        "'Trebuchet MS', serif",
        70
      );
      ctx.fillText(`${volunteer.nom} ${volunteer.prenom}`, textNameX, textNameY);

      /* -------------------- QR CODE -------------------- */
      const qrRect = cmToPx(ZONE_QR_CM, canvas);
      const qrSize = Math.min(qrRect.width, qrRect.height) - 10;
      const qrX = qrRect.x + (qrRect.width - qrSize) / 2;
      const qrY = qrRect.y + (qrRect.height - qrSize) / 2;

      const frontendBaseUrl = "https://ampbenin.netlify.app/verify";
      const qrData = `${frontendBaseUrl}/${attestation._id.toString()}`;

      const qrBuffer = await QRCode.toBuffer(qrData, { width: qrSize });
      const qrImage = await loadImage(qrBuffer);
      ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      /* -------------------- PDF -------------------- */
      const pdfDoc = await PDFDocument.create();
      // Export JPEG compressé pour réduire le poids
      const jpgBytes = canvas.toBuffer("image/jpeg", { quality: 0.8 });
      const pdfImage = await pdfDoc.embedJpg(jpgBytes);

      const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
      page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });

      const pdfBytes = await pdfDoc.save();
      const uploadedFile = await uploadFromBuffer(pdfBytes, "attestations");

      attestation.fileUrl = uploadedFile.secure_url;
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

    res.json({
      nom: volunteer.nom,
      prenom: volunteer.prenom,
      email: volunteer.email,
      telephone: volunteer.telephone,
      mission: program.title,
      date: attestation.uploadedAt || volunteer.updatedAt,
      // Ajouté le 2026-08-19 — jamais renvoyé avant, alors que
      // VerifyAttestation.jsx attend data.fileUrl depuis toujours pour
      // afficher le lien "Télécharger" (bug corrigé au passage).
      fileUrl: attestation.fileUrl || null,
    });
  } catch (error) {
    console.error("❌ verifyAttestation erreur :", error);
    res.status(500).json({ error: true });
  }
};

module.exports = {
  fetchVolunteersForCertificate,
  generateCertificate,
  verifyAttestation,
};
