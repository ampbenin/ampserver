const Volunteer = require("../models/volunteer");
const Mission = require("../models/mission");
const cloudinary = require("../utils/cloudinary");
const { PDFDocument } = require("pdf-lib");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const streamifier = require("streamifier");

/* -------------------- Récupérer les volontaires prêts pour attestation -------------------- */
const fetchVolunteersForCertificate = async (req, res) => {
  try {
    const { titre } = req.body;
    if (!titre) return res.status(400).json({ message: "Titre de mission requis" });

    const mission = await Mission.findOne({ titre });
    if (!mission) return res.status(404).json({ message: "Mission introuvable" });

    let volunteers = await Volunteer.find({ "missions.missionId": mission._id }).lean();

    // Filtrer : statut "Mission validée" pour cette mission et attestation non encore générée
    volunteers = volunteers.filter(v =>
      v.missions.some(m => m.missionId.toString() === mission._id.toString() && m.statut === "Mission validée") &&
      !v.attestations?.some(a => a.missionId.toString() === mission._id.toString())
    );

    const response = volunteers.map(v => {
      const missionData = v.missions.find(m => m.missionId.toString() === mission._id.toString());
      return {
        _id: v._id,
        nom: v.nom,
        prenom: v.prenom,
        email: v.email,
        telephone: v.telephone,
        missionStatus: missionData?.statut || "Non disponible",
      };
    });

    res.status(200).json({
      mission: { _id: mission._id, titre: mission.titre },
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

const generateCertificate = async (req, res) => {
  try {
    const { titre, email, mode } = req.body;
    if (!titre) return res.status(400).json({ message: "Titre de mission requis" });

    const mission = await Mission.findOne({ titre });
    if (!mission) return res.status(404).json({ message: "Mission introuvable" });

    let volunteers = [];
    if (mode === "Tous les volontaires") {
      volunteers = await Volunteer.find({ "missions.missionId": mission._id }).populate("missions.missionId");
    } else if (mode === "Un volontaire" && email) {
      const v = await Volunteer.findOne({ email, "missions.missionId": mission._id }).populate("missions.missionId");
      if (v) volunteers.push(v);
    }

    // Filtrer : uniquement les missions validées et sans attestation
    volunteers = volunteers.filter(v => {
      const m = v.missions.find(m => m.missionId._id.toString() === mission._id.toString() && m.statut === "Mission validée");
      const alreadyGenerated = v.attestations?.some(a => a.missionId.toString() === mission._id.toString());
      return m && !alreadyGenerated;
    });

    if (volunteers.length === 0) return res.status(404).json({ message: "Aucun volontaire trouvé" });

    let generatedCount = 0;

    for (const volunteer of volunteers) {
      const missionInfo = volunteer.missions.find(m => m.missionId._id.toString() === mission._id.toString());

      // Ajouter attestation vide pour générer un _id
      volunteer.attestations.push({
        missionId: mission._id,
        missionName: mission.titre,
        statut: missionInfo.statut,
      });
      await volunteer.save();

      const attestation = volunteer.attestations[volunteer.attestations.length - 1];

      // Charger le template
      const templatePath = path.resolve(__dirname, "../assets/attestation_mycountr229_08_2025.png");
      const templateBuffer = fs.readFileSync(templatePath);
      const templateImage = await loadImage(templateBuffer);

      const canvas = createCanvas(templateImage.width, templateImage.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(templateImage, 0, 0);

      // Écriture Nom + Prénom
      const rectName = { x1: 329, y1: 619, x2: 1639, y2: 723 };
      const rectNameWidth = rectName.x2 - rectName.x1;
      const rectNameHeight = rectName.y2 - rectName.y1;
      const textNameX = rectName.x1 + rectNameWidth / 2;
      const textNameY = rectName.y1 + rectNameHeight / 2;

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

      ctx.fillStyle = "#190d86ff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fitNameText(ctx, `${volunteer.nom} ${volunteer.prenom}`, rectNameWidth, rectNameHeight, "'Trebuchet MS', serif", 70);
      ctx.fillText(`${volunteer.nom} ${volunteer.prenom}`, textNameX, textNameY);

      // Génération QR Code
      const rect = { x1: 193, y1: 1269, x2: 404, y2: 1052 };
      const rectWidth = rect.x2 - rect.x1;
      const rectHeight = rect.y1 - rect.y2;
      const qrSize = Math.min(rectWidth, rectHeight) - 10;
      const qrX = rect.x1 + (rectWidth - qrSize) / 2;
      const qrY = rect.y2 + (rectHeight - qrSize) / 2;

      const frontendBaseUrl = "https://ampbenin.netlify.app/verify";
      const attestationId = attestation._id.toString();
      const qrData = `${frontendBaseUrl}/${attestationId}`;

      const qrBuffer = await QRCode.toBuffer(qrData, { width: qrSize });
      const qrImage = await loadImage(qrBuffer);
      ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      // Génération PDF
      const pdfDoc = await PDFDocument.create();
      const pngBytes = canvas.toBuffer("image/png");
      const pdfImage = await pdfDoc.embedPng(pngBytes);
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
      mission: mission.titre,
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

    // 1️⃣ Vérifications de base
    if (!email || !nom) {
      return res.status(400).json({
        message: "Email et nom sont requis",
      });
    }

    // 2️⃣ Recherche du volontaire
    const volunteer = await Volunteer.findOne({ email })
      .populate("missions.missionId");

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

    // 4️⃣ Aucune mission
    if (!volunteer.missions || volunteer.missions.length === 0) {
      return res.status(404).json({
        message: "Aucune mission n'est assignée à ce volontaire",
      });
    }

    /* ===================== ÉTAPE 1 : RETOUR DES MISSIONS ===================== */
    if (!titre) {
      const missionsList = volunteer.missions.map(m => ({
        titre: m.missionId?.titre,
        statut: m.statut,
      }));

      return res.status(200).json({ missions: missionsList });
    }

    /* ===================== ÉTAPE 2 : TÉLÉCHARGEMENT ===================== */

    // 5️⃣ Vérification mission
    const mission = await Mission.findOne({ titre });
    if (!mission) {
      return res.status(404).json({
        message: "Mission sélectionnée introuvable",
      });
    }

    // 6️⃣ Mission liée au volontaire
    const missionData = volunteer.missions.find(
      m => m.missionId._id.toString() === mission._id.toString()
    );

    if (!missionData) {
      return res.status(403).json({
        message: "Aucune mission valide pour ce volontaire",
      });
    }

    // 7️⃣ Gestion des statuts (NOUVEAU MODEL, ANCIEN COMPORTEMENT)
    if (missionData.statut === "Non disponible") {
      return res.status(403).json({
        message:
          "Vous n'avez pas renseigner le rapport de fin de mission ou vous n'y avez point participé",
      });
    }

    if (missionData.statut === "Refusé") {
      return res.status(403).json({
        message:
          "Désolé, vous n'avez pas rempli les conditions de la mission pour télécharger votre attestation",
      });
    }

    // 8️⃣ Vérification attestation
    const cert = volunteer.attestations.find(
      a => a.missionId.toString() === mission._id.toString()
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

    const mission = await Mission.findById(attestation.missionId).lean();
    if (!mission) return res.json({ error: true });

    res.json({
      nom: volunteer.nom,
      prenom: volunteer.prenom,
      email: volunteer.email,
      telephone: volunteer.telephone,
      mission: mission.titre,
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
