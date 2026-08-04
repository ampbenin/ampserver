const Volunteer = require("../models/volunteer");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const cloudinary = require("../utils/cloudinary");
const { PDFDocument } = require("pdf-lib");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const streamifier = require("streamifier");

/* Adapté pour référencer VolunteerProgram (remplace Mission) — voir le
   commentaire en tête de controllers/volunteerController.js pour la limite
   de populate() cross-connection (VolunteerProgram vit sur global.formDB,
   Volunteer sur la connexion par défaut) : les titres de programme sont
   résolus manuellement, jamais via .populate("programs.programId").

   `downloadCertificate` et `verifyAttestation` sont des points d'entrée
   PUBLICS déjà consommés par AttestationForm.jsx et verify/[id].astro — la
   FORME de leur réponse JSON (clés "missions"/"mission") est délibérément
   conservée telle quelle pour ne pas devoir toucher ces deux pages dans ce
   chantier ; seule la source des données change en interne
   (VolunteerProgram au lieu de Mission). */

/* -------------------- Récupérer les volontaires prêts pour attestation -------------------- */
const fetchVolunteersForCertificate = async (req, res) => {
  try {
    const { titre } = req.body;
    if (!titre) return res.status(400).json({ message: "Titre de programme requis" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findOne({ title: titre });
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    let volunteers = await Volunteer.find({ "programs.programId": program._id }).lean();

    // Filtrer : statut "Mission validée" pour ce programme et attestation non encore générée
    volunteers = volunteers.filter(v =>
      v.programs.some(p => p.programId.toString() === program._id.toString() && p.statut === "Mission validée") &&
      !v.attestations?.some(a => a.programId.toString() === program._id.toString())
    );

    const response = volunteers.map(v => {
      const programData = v.programs.find(p => p.programId.toString() === program._id.toString());
      return {
        _id: v._id,
        nom: v.nom,
        prenom: v.prenom,
        email: v.email,
        telephone: v.telephone,
        missionStatus: programData?.statut || "Non disponible",
      };
    });

    res.status(200).json({
      mission: { _id: program._id, titre: program.title },
      volunteers: response,
      total: response.length,
    });
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
    const { titre, email, mode } = req.body;
    if (!titre)
      return res.status(400).json({ message: "Titre de programme requis" });

    const Program = getVolunteerProgramModel();
    const program = await Program.findOne({ title: titre });
    if (!program)
      return res.status(404).json({ message: "Programme introuvable" });

    let volunteers = [];
    if (mode === "Tous les volontaires") {
      volunteers = await Volunteer.find({
        "programs.programId": program._id,
      });
    } else if (mode === "Un volontaire" && email) {
      const v = await Volunteer.findOne({
        email,
        "programs.programId": program._id,
      });
      if (v) volunteers.push(v);
    }

    // Filtrer : programmes validés et sans attestation
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
      return res.status(404).json({ message: "Aucun volontaire trouvé" });

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
      mission: program.title,
    });
  } catch (error) {
    console.error("❌ generateCertificate erreur :", error);
    res.status(500).json({ message: error.message });
  }
};


/* -------------------- Télécharger une attestation -------------------- */
const downloadCertificate = async (req, res) => {
  try {
    const { email, nom, titre } = req.body;
    const Program = getVolunteerProgramModel();

    // 1️⃣ Vérifications de base
    if (!email || !nom) {
      return res.status(400).json({
        message: "Email et nom sont requis",
      });
    }

    // 2️⃣ Recherche du volontaire
    const volunteer = await Volunteer.findOne({ email });

    if (!volunteer) {
      return res.status(404).json({
        message:
          "Vous n'êtes pas inscrit(e) dans la base des volontaires AMP BENIN ou vous avez mal saisi votre adresse email",
      });
    }

    // 3️⃣ Vérification du nom de famille (ancien comportement)
    if (volunteer.nom.toLowerCase() !== nom.toLowerCase()) {
      return res.status(400).json({
        message:
          "Nom incorrect pour ce volontaire. Il s'agit uniquement de votre nom de famille",
      });
    }

    // 4️⃣ Aucun programme
    if (!volunteer.programs || volunteer.programs.length === 0) {
      return res.status(404).json({
        message: "Aucune mission n'est assignée à ce volontaire",
      });
    }

    /* ===================== ÉTAPE 1 : RETOUR DES MISSIONS ===================== */
    if (!titre) {
      const programIds = volunteer.programs.map((p) => p.programId);
      const programs = await Program.find({ _id: { $in: programIds } }).select("title");
      const titleById = new Map(programs.map((p) => [String(p._id), p.title]));

      const missionsList = volunteer.programs.map(p => ({
        titre: titleById.get(String(p.programId)) || null,
        statut: p.statut,
      }));

      return res.status(200).json({ missions: missionsList });
    }

    /* ===================== ÉTAPE 2 : TÉLÉCHARGEMENT ===================== */

    // 5️⃣ Vérification programme
    const program = await Program.findOne({ title: titre });
    if (!program) {
      return res.status(404).json({
        message: "Mission sélectionnée introuvable",
      });
    }

    // 6️⃣ Programme lié au volontaire
    const programData = volunteer.programs.find(
      p => p.programId.toString() === program._id.toString()
    );

    if (!programData) {
      return res.status(403).json({
        message: "Aucune mission valide pour ce volontaire",
      });
    }

    // 7️⃣ Gestion des statuts (NOUVEAU MODEL, ANCIEN COMPORTEMENT)
    if (programData.statut === "Non disponible") {
      return res.status(403).json({
        message:
          "Vous n'avez pas renseigner le rapport de fin de mission ou vous n'y avez point participé",
      });
    }

    if (programData.statut === "Refusé") {
      return res.status(403).json({
        message:
          "Désolé, vous n'avez pas rempli les conditions de la mission pour télécharger votre attestation",
      });
    }

    // 8️⃣ Vérification attestation
    const cert = volunteer.attestations.find(
      a => a.programId.toString() === program._id.toString()
    );

    if (!cert) {
      return res.status(404).json({
        message:
          "Merci pour avoir achevé cette mission. Votre attestation sera disponible bientôt",
      });
    }

    if (!cert.fileUrl) {
      return res.status(500).json({
        message: "Lien de l'attestation manquant",
      });
    }

    // 9️⃣ Succès
    return res.status(200).json({ url: cert.fileUrl });

  } catch (error) {
    console.error("❌ downloadCertificate erreur :", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
};


/* -------------------- Vérification d'une attestation via son ObjectId -------------------- */
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
    });
  } catch (error) {
    console.error("❌ verifyAttestation erreur :", error);
    res.status(500).json({ error: true });
  }
};

module.exports = {
  fetchVolunteersForCertificate,
  generateCertificate,
  downloadCertificate,
  verifyAttestation,
};
