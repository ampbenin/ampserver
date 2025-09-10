const Volunteer = require("../models/volunteer");
const Mission = require("../models/mission");
const cloudinary = require("../utils/cloudinary");
const { PDFDocument } = require("pdf-lib");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const streamifier = require("streamifier");

// 🔹 Récupérer les volontaires prêts pour attestation
const fetchVolunteersForCertificate = async (req, res) => {
  try {
    const { titre } = req.body;
    if (!titre) return res.status(400).json({ message: "Titre de mission requis" });

    const mission = await Mission.findOne({ titre });
    if (!mission) return res.status(404).json({ message: "Mission introuvable" });

    let volunteers = await Volunteer.find({ mission: mission._id, statut: "Mission validée" }).lean();
    volunteers = volunteers.filter(v => !v.attestations?.some(a => a.missionId.toString() === mission._id.toString()));

    const response = volunteers.map(v => ({
      _id: v._id,
      nom: v.nom,
      prenom: v.prenom,
      email: v.email,
      telephone: v.telephone,
    }));

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

// 🔹 Génération des attestations PDF et upload direct via buffer/stream
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

    console.log("👉 Mission trouvée :", mission.titre);

    let volunteers = [];
    if (mode === "Tous les volontaires") {
      volunteers = await Volunteer.find({ mission: mission._id, statut: "Mission validée" });
    } else if (mode === "Un volontaire" && email) {
      const v = await Volunteer.findOne({ email, mission: mission._id, statut: "Mission validée" });
      if (v) volunteers.push(v);
    }

    if (volunteers.length === 0) return res.status(404).json({ message: "Aucun volontaire trouvé" });
    console.log(`👉 Volontaires à générer : ${volunteers.length}`);

    let generatedCount = 0;

    for (const volunteer of volunteers) {
      console.log("📄 Génération attestation pour :", volunteer.email);

      const alreadyGenerated = volunteer.attestations.some(a => a.missionId.toString() === mission._id.toString());
      if (alreadyGenerated) {
        console.log("⚠️ Attestation déjà générée pour :", volunteer.email);
        continue;
      }

      // 1️⃣ On crée d'abord une attestation vide (sans fileUrl ni uploadedAt)
      volunteer.attestations.push({
        missionId: mission._id,
        missionName: mission.titre,
        statut: volunteer.statut,
      });

      // Sauvegarde pour générer l’_id
      await volunteer.save();

      // On récupère la dernière attestation (celle qu’on vient d’ajouter)
      const attestation = volunteer.attestations[volunteer.attestations.length - 1];

      // 2️⃣ Charger le modèle d’attestation via buffer
      const templatePath = path.resolve(__dirname, "../assets/attestation_mycountr229_08_2025.png");
      console.log("📌 Chargement du template :", templatePath);
      const templateBuffer = fs.readFileSync(templatePath);
      const templateImage = await loadImage(templateBuffer);

      const canvas = createCanvas(templateImage.width, templateImage.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(templateImage, 0, 0);

      // 3️⃣ Écrire Nom + Prénom (ajusté automatiquement à la zone dédiée)
const rectName = { x1: 329, y1: 619, x2: 1639, y2: 723 };

// Dimensions et centre de la zone
const rectNameWidth = rectName.x2 - rectName.x1;   // 1310 px
const rectNameHeight = rectName.y2 - rectName.y1;  // 104 px
const textNameX = rectName.x1 + rectNameWidth / 2;
const textNameY = rectName.y1 + rectNameHeight / 2;

// Fonction pour adapter la taille du texte
function fitNameText(ctx, text, maxWidth, maxHeight, fontFamily, initialSize) {
  let fontSize = initialSize;
  do {
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (metrics.width <= maxWidth && textHeight <= maxHeight) break;
    fontSize--;
  } while (fontSize > 10); // sécurité : minimum 10px
  return ctx.font;
}

// Application
ctx.fillStyle = "#190d86ff";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.font = fitNameText(ctx, `${volunteer.nom} ${volunteer.prenom}`, rectNameWidth, rectNameHeight, "'Trebuchet MS', serif", 70);

// Dessin du texte centré
ctx.fillText(`${volunteer.nom} ${volunteer.prenom}`, textNameX, textNameY);


      // 4️⃣ Générer QR Code avec lien vers le frontend

// 🔹 Coordonnées du rectangle (issues de image-map.net)
const rect = { x1: 193, y1: 1269, x2: 404, y2: 1052 };

// Dimensions du rectangle
const rectWidth = rect.x2 - rect.x1;   // 211 px
const rectHeight = rect.y1 - rect.y2;  // 217 px

// Taille du QR code (un peu plus petit que le rectangle pour laisser de la marge)
const qrSize = Math.min(rectWidth, rectHeight) - 10; // ex: 201 px

// Position (centrée dans le rectangle)
const qrX = rect.x1 + (rectWidth - qrSize) / 2;
const qrY = rect.y2 + (rectHeight - qrSize) / 2;

// 🔹 Génération du QR code
const frontendBaseUrl = "https://ampbenin.netlify.app/verify";
const attestationId = attestation._id.toString();
const qrData = `${frontendBaseUrl}/${attestationId}`;

const qrBuffer = await QRCode.toBuffer(qrData, { width: qrSize });
const qrImage = await loadImage(qrBuffer);

// Dessiner le QR Code bien centré dans la zone
ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      // 5️⃣ Générer PDF paysage depuis le canvas
      const pdfDoc = await PDFDocument.create();
      const pngBytes = canvas.toBuffer("image/png");
      const pdfImage = await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
      page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });

      const pdfBytes = await pdfDoc.save();

      console.log(`✅ PDF généré pour : ${volunteer.email}`);
      console.log(`📏 Taille du PDF en mémoire : ${pdfBytes.length} octets`);

      // 6️⃣ Upload via stream depuis buffer
      const uploadedFile = await uploadFromBuffer(pdfBytes, "attestations");
      console.log("☁️ Upload Cloudinary terminé :", uploadedFile.secure_url);

      // 7️⃣ Mise à jour de la même attestation avec fileUrl et uploadedAt
      attestation.fileUrl = uploadedFile.secure_url;
      attestation.uploadedAt = new Date();
      await volunteer.save();

      generatedCount++;
      console.log("🎯 Attestation sauvegardée pour :", volunteer.email);
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


// 🔹 Télécharger une attestation ou lister les missions
const downloadCertificate = async (req, res) => {
  try {
    const { email, nom, titre } = req.body;
    if (!email || !nom) {
      return res
        .status(400)
        .json({ message: "Email et nom sont requis" });
    }

    // ✅ Vérification email
    const volunteer = await Volunteer.findOne({ email }).populate("mission");
    if (!volunteer) {
      return res.status(404).json({
        message:
          "Vous n'êtes pas inscrit(e) dans la base des volontaires AMP BENIN ou vous avez mal saisi votre adresse email",
      });
    }

    // ✅ Vérification du nom de famille (uniquement `nom`, pas fullName)
    if (volunteer.nom.toLowerCase() !== nom.toLowerCase()) {
      return res.status(400).json({
        message:
          "Nom incorrect pour ce volontaire. Il s'agit uniquement de votre nom de famille",
      });
    }

    // ✅ Vérification des missions assignées
    if (!volunteer.mission) {
      return res.status(404).json({
        message: "Aucune mission n'est assignée à ce volontaire",
      });
    }

    // Étape 1 : retour des missions si aucun titre n’est fourni
    if (!titre) {
      const mission = await Mission.findById(volunteer.mission);
      if (!mission) {
        return res.status(404).json({
          message: "Mission introuvable dans la base de données",
        });
      }
      return res.status(200).json({
        missions: [{ titre: mission.titre }],
      });
    }

    // Étape 2 : utilisateur a sélectionné un titre
    const mission = await Mission.findOne({ titre });
    if (!mission) {
      return res
        .status(404)
        .json({ message: "Mission sélectionnée introuvable" });
    }

    // Vérification du statut du volontaire
    if (volunteer.statut === "Non disponible") {
      return res.status(403).json({
        message: "Vous n'avez pas renseigner le raport de fin de mission ou vous n'y avez point participer",
      });
    }

    if (volunteer.statut === "Refusé") {
      return res.status(403).json({
        message:
          "Désolé, vous n'avez pas rempli les conditions de la mission pour télécharger votre attestation",
      });
    }

    // Vérifier dans le tableau `attestations` si une attestation existe pour cette mission
    const cert = volunteer.attestations.find(
      (a) => a.missionId.toString() === mission._id.toString()
    );

    if (!cert) {
      return res.status(404).json({
        message:
          "Merci pour avoir achevé cette mission. Votre attestation sera disponible bientôt",
      });
    }

    // Vérifier si un lien est bien disponible
    if (!cert.fileUrl) {
      return res.status(500).json({
        message: "Lien de l'attestation manquant",
      });
    }

    // ✅ Succès → renvoi du lien
    return res.status(200).json({ url: cert.fileUrl });
  } catch (error) {
    console.error("❌ downloadCertificate erreur :", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// 🔹 Vérification d'une attestation via son ObjectId
const verifyAttestation = async (req, res) => {
  try {
    const { id } = req.params; // id = _id de l'attestation
    if (!id) return res.status(400).json({ error: "ID de l'attestation manquant" });

    // 1️⃣ Trouver le volontaire qui possède cette attestation
    const volunteer = await Volunteer.findOne({ "attestations._id": id }).lean();
    if (!volunteer) return res.json({ error: true });

    // 2️⃣ Récupérer l'attestation exacte
    const attestation = volunteer.attestations.find(a => a._id.toString() === id);
    if (!attestation) return res.json({ error: true });

    // 3️⃣ Récupérer la mission
    const mission = await Mission.findById(attestation.missionId).lean();
    if (!mission) return res.json({ error: true });

    // 4️⃣ Retourner les informations au frontend
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


// ✅ Export
module.exports = {
  fetchVolunteersForCertificate,
  generateCertificate,
  downloadCertificate,
  verifyAttestation,
};

