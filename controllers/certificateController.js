const Volunteer = require("../models/volunteer");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const { canReviewProgram } = require("./volunteerProgramController");
const cloudinary = require("../utils/cloudinary");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
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

/* ════════════════════════════════════════════════════════════════════
   Génération du certificat — refondue le 2026-08-19 (décision
   utilisateur) : "on met juste en place un système de génération de pdf
   A4 format paysage avec un modèle moderne de certificat premium. Plus
   besoin de mettre un fichier template. Donc peu importe le programme,
   on va utiliser le même système." Tout est dessiné par code (aucune
   image de template) — un fond décoratif (cadre, ornements, logo, sceau)
   rendu une seule fois via @napi-rs/canvas ET RÉUTILISÉ pour tous les
   volontaires d'un même lot (identique pour tous), le texte propre à
   chaque volontaire (nom, programme, date, QR) est dessiné par-dessus en
   TEXTE VECTORIEL via pdf-lib + @pdf-lib/fontkit (net à l'impression,
   PDF léger, contrairement à l'ancien système qui rasterisait tout —
   texte compris — en JPEG). Polices Fraunces/DM Sans embarquées dans
   assets/fonts/ (mêmes polices que le site, fournies par l'utilisateur —
   aucun accès réseau sortant possible depuis cet environnement pour les
   télécharger ; @napi-rs/canvas et pdf-lib n'embarquent aucune police par
   défaut, dépendre des polices du serveur de production aurait été trop
   risqué). ════════════════════════════════════════════════════════════ */

// A4 paysage, en points PDF (1pt = 1/72 pouce) — 297 × 210 mm.
const PAGE_W = 842;
const PAGE_H = 595;

// Palette — identique aux tokens de marque du site (src/styles/tokens.css).
const COLORS = {
  cream: "#FDFBF6",
  green: "#1B4332",
  greenLight: "#2D6A4F",
  gold: "#C9903A",
  goldLight: "#E8C47A",
  goldDark: "#A87028",
  textMuted: "#6B6558",
};
const rgbHex = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const FONT_DIR = path.resolve(__dirname, "../assets/fonts");
const FONT_FILES = {
  regular: "DMSans-Regular.ttf",
  medium: "DMSans-Medium.ttf",
  bold: "DMSans-Bold.ttf",
  heading: "Fraunces-Bold.ttf",
  nameScript: "Fraunces-SemiBoldItalic.ttf",
  tagline: "Fraunces-Italic.ttf",
};
// Lus une seule fois au démarrage — réutilisés pour chaque volontaire
// (l'embed dans un PDFDocument doit se refaire par document, mais la
// lecture disque, elle, ne se refait pas).
const FONT_BYTES = Object.fromEntries(
  Object.entries(FONT_FILES).map(([key, file]) => [key, fs.readFileSync(path.join(FONT_DIR, file))])
);

const LOGO_PATH = path.resolve(__dirname, "../assets/amp_logo.png");

/* -------------------- Fond décoratif (identique pour tout le monde, construit UNE fois -------------------- */
async function buildDecorativeBackground() {
  const scale = 4; // rendu ~288 DPI pour un résultat net à l'impression
  const S = (n) => Math.round(n * scale);
  const canvas = createCanvas(S(PAGE_W), S(PAGE_H));
  const ctx = canvas.getContext("2d");

  // Fond crème.
  ctx.fillStyle = COLORS.cream;
  ctx.fillRect(0, 0, S(PAGE_W), S(PAGE_H));

  // Double cadre (or fin extérieur, vert plus épais à l'intérieur).
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = S(1.4);
  ctx.strokeRect(S(26), S(26), S(PAGE_W - 52), S(PAGE_H - 52));
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = S(2.4);
  ctx.strokeRect(S(37), S(37), S(PAGE_W - 74), S(PAGE_H - 74));

  // Ornements d'angle — petit losange doré à double épaisseur.
  [[37, 37], [PAGE_W - 37, 37], [37, PAGE_H - 37], [PAGE_W - 37, PAGE_H - 37]].forEach(([cx, cy]) => {
    ctx.save();
    ctx.translate(S(cx), S(cy));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(-S(8), -S(8), S(16), S(16));
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(-S(4.5), -S(4.5), S(9), S(9));
    ctx.restore();
  });

  // Logo AMP BÉNIN — centré en haut, découpé en cercle avec liseré doré.
  try {
    const logo = await loadImage(fs.readFileSync(LOGO_PATH));
    const cx = PAGE_W / 2, cy = 66, r = 34;
    ctx.save();
    ctx.beginPath();
    ctx.arc(S(cx), S(cy), S(r), 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, S(cx - r), S(cy - r), S(r * 2), S(r * 2));
    ctx.restore();
    ctx.beginPath();
    ctx.arc(S(cx), S(cy), S(r), 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = S(1.6);
    ctx.stroke();
  } catch (err) {
    console.error("⚠️ Logo non chargé pour le certificat (ignoré) :", err.message);
  }

  // Ligne décorative + petit losange, sous le titre.
  const drawDivider = (cy) => {
    const half = 55;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = S(1);
    ctx.beginPath();
    ctx.moveTo(S(PAGE_W / 2 - half), S(cy));
    ctx.lineTo(S(PAGE_W / 2 - 6), S(cy));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(S(PAGE_W / 2 + 6), S(cy));
    ctx.lineTo(S(PAGE_W / 2 + half), S(cy));
    ctx.stroke();
    ctx.save();
    ctx.translate(S(PAGE_W / 2), S(cy));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(-S(3.5), -S(3.5), S(7), S(7));
    ctx.restore();
  };
  drawDivider(196);

  // Sceau circulaire (médaille) en bas au centre — remplace la signature
  // scannée : plus "moderne", cohérent avec la vérification par QR déjà
  // en place (verifyAttestation).
  const sealCx = PAGE_W / 2, sealCy = 452, sealR = 40;
  ctx.save();
  ctx.translate(S(sealCx), S(sealCy));
  // rayons façon médaille
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = S(1.1);
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * S(sealR + 3), Math.sin(angle) * S(sealR + 3));
    ctx.lineTo(Math.cos(angle) * S(sealR + 9), Math.sin(angle) * S(sealR + 9));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, S(sealR), 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = S(2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, S(sealR - 7), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.green;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, S(sealR - 7), 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.goldLight;
  ctx.lineWidth = S(1);
  ctx.stroke();
  // coche centrale
  ctx.strokeStyle = COLORS.goldLight;
  ctx.lineWidth = S(3.2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-S(14), S(1));
  ctx.lineTo(-S(4), S(12));
  ctx.lineTo(S(16), -S(13));
  ctx.stroke();
  ctx.restore();

  // Ligne de signature (droite) — sans nom de personne (générique,
  // décision de conception : évite de figer un nom qui changera avec le
  // temps, cohérent avec le sceau + QR déjà pensés comme "signature").
  ctx.strokeStyle = `${COLORS.green}99`;
  ctx.lineWidth = S(1);
  ctx.beginPath();
  ctx.moveTo(S(612), S(488));
  ctx.lineTo(S(786), S(488));
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

let cachedBackgroundPromise = null;
const getDecorativeBackground = () => {
  if (!cachedBackgroundPromise) cachedBackgroundPromise = buildDecorativeBackground();
  return cachedBackgroundPromise;
};

/* -------------------- Aides texte vectoriel (pdf-lib) -------------------- */
// topY = distance depuis le HAUT de la page (plus intuitif à composer) —
// pdf-lib mesure depuis le bas, la conversion se fait ici une seule fois.
const drawCentered = (page, font, text, size, topY, color) => {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_W - width) / 2, y: PAGE_H - topY, size, font, color });
  return width;
};

// Texte "espacé" (tracking) façon gravure — dessiné lettre par lettre.
const drawTracked = (page, font, text, size, topY, color, tracking) => {
  const chars = [...text];
  const totalWidth = chars.reduce((sum, ch, i) => sum + font.widthOfTextAtSize(ch, size) + (i > 0 ? tracking : 0), 0);
  let x = (PAGE_W - totalWidth) / 2;
  const y = PAGE_H - topY;
  chars.forEach((ch) => {
    page.drawText(ch, { x, y, size, font, color });
    x += font.widthOfTextAtSize(ch, size) + tracking;
  });
};

// Réduit la taille de police jusqu'à ce que le texte tienne dans maxWidth.
const fitSize = (font, text, maxWidth, startSize, minSize) => {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
};

// Découpe en au plus `maxLines` lignes tenant dans maxWidth (mot par mot).
const wrapLines = (font, text, size, maxWidth, maxLines) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
};

/* -------------------- Un PDF de certificat pour un volontaire -------------------- */
async function renderCertificatePdf({ volunteerName, programTitle, referenceCode, qrUrl }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [fontRegular, fontMedium, fontBold, fontHeading, fontName, fontTagline] = await Promise.all([
    pdfDoc.embedFont(FONT_BYTES.regular),
    pdfDoc.embedFont(FONT_BYTES.medium),
    pdfDoc.embedFont(FONT_BYTES.bold),
    pdfDoc.embedFont(FONT_BYTES.heading),
    pdfDoc.embedFont(FONT_BYTES.nameScript),
    pdfDoc.embedFont(FONT_BYTES.tagline),
  ]);

  const backgroundBytes = await getDecorativeBackground();
  const backgroundImage = await pdfDoc.embedPng(backgroundBytes);

  const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 240, margin: 0, color: { dark: "#1B4332", light: "#00000000" } });
  const qrImage = await pdfDoc.embedPng(qrBuffer);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  page.drawImage(backgroundImage, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  const green = rgbHex(COLORS.green);
  const gold = rgbHex(COLORS.goldDark);
  const muted = rgbHex(COLORS.textMuted);

  drawTracked(page, fontMedium, "ACTIONS POUR UN MONDE PRODUCTIF", 9, 128, gold, 2.4);
  drawTracked(page, fontHeading, "ATTESTATION DE FIN DE MISSION", 27, 172, green, 2.2);

  drawCentered(page, fontTagline, "Décerné(e) à", 13, 222, muted);

  // Le nom tient sur une ligne dans l'immense majorité des cas (rétrécit
  // jusqu'à 24pt) — mais certains noms composés béninois sont trop longs
  // même à cette taille (signalé lors des tests : un nom à 6 mots débordait
  // du cadre). Repli sur 2 lignes plutôt que de laisser déborder — jamais
  // vérifié avant la refonte 2026-08-19 puisque l'ancien système ne
  // gérait pas ce cas non plus.
  const nameMaxWidth = 660;
  let nameSize = fitSize(fontName, volunteerName, nameMaxWidth, 40, 24);
  let nameLines = [volunteerName];
  if (fontName.widthOfTextAtSize(volunteerName, nameSize) > nameMaxWidth) {
    nameSize = 27;
    while (nameSize > 18) {
      nameLines = wrapLines(fontName, volunteerName, nameSize, nameMaxWidth, 2);
      if (nameLines.every((l) => fontName.widthOfTextAtSize(l, nameSize) <= nameMaxWidth)) break;
      nameSize -= 1;
    }
  }
  const nameLineGap = nameSize * 1.08;
  nameLines.forEach((line, i) => drawCentered(page, fontName, line, nameSize, 272 + i * nameLineGap, green));
  // Décale tout ce qui suit d'autant de lignes supplémentaires que le nom
  // en a pris (0 dans le cas courant, une seule ligne).
  const shift = (nameLines.length - 1) * nameLineGap;

  const bodySize = 13;
  const bodyMaxWidth = 560;
  drawCentered(
    page, fontRegular,
    "pour sa participation exemplaire et son engagement remarquable dans le cadre du programme",
    bodySize, 316 + shift, muted
  );
  const programLines = wrapLines(fontBold, programTitle, 16, bodyMaxWidth, 2);
  programLines.forEach((line, i) => {
    drawCentered(page, fontBold, line, 16, 340 + shift + i * 20, green);
  });
  // Position réelle (pas un seuil arbitraire) juste sous la dernière ligne
  // de programme effectivement dessinée. Le sceau occupe topY 403-501
  // (rayons compris — voir sealCy=452 dans buildDecorativeBackground), à
  // position FIXE (fond décoratif partagé/mis en cache) : dans le pire cas
  // cumulé (nom ET programme longs à la fois), il ne reste plus assez de
  // place pour la date sans chevaucher le sceau — on l'omet alors plutôt
  // que de la superposer (vérifié visuellement : un seuil fixe, essayé
  // d'abord, chevauchait tantôt le sceau, tantôt le programme lui-même
  // selon les cas — ce calcul dynamique est fiable dans tous les cas).
  const programEndY = 340 + shift + (programLines.length - 1) * 20;
  const dateTopY = programEndY + 26;
  if (dateTopY <= 390) {
    const dateLabel = `Fait à Cotonou, le ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
    drawCentered(page, fontRegular, dateLabel, 11, dateTopY, muted);
  }

  // QR code (bas gauche) + légende — remonté de 18pt (signalé : la légende
  // touchait presque le cadre inférieur).
  const qrSize = 58;
  const qrTopY = 482;
  page.drawImage(qrImage, { x: 64, y: PAGE_H - qrTopY - qrSize, width: qrSize, height: qrSize });
  page.drawText("Vérifier l'authenticité", {
    x: 64, y: PAGE_H - qrTopY - qrSize - 12, size: 7.5, font: fontRegular, color: muted,
  });

  // Libellé sous le sceau.
  drawCentered(page, fontBold, "AMP BÉNIN", 10, 508, green);
  drawCentered(page, fontRegular, "Mission accomplie", 8, 520, muted);

  // Bloc signature (droite).
  page.drawText("Direction Exécutive", { x: 612, y: PAGE_H - 504, size: 9.5, font: fontMedium, color: green });
  page.drawText("AMP BÉNIN", { x: 612, y: PAGE_H - 516, size: 8, font: fontRegular, color: muted });

  // Référence, tout en bas, discrète.
  drawCentered(page, fontRegular, `Réf. ${referenceCode}`, 7, 566, muted);

  return pdfDoc.save();
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

      // Créer une attestation vide pour générer l'ID (le QR encode cet ID,
      // voir verifyAttestation — il faut donc l'ID AVANT de dessiner le PDF).
      volunteer.attestations.push({
        programId: program._id,
        programName: program.title,
        statut: programInfo.statut,
      });
      await volunteer.save();

      const attestation = volunteer.attestations[volunteer.attestations.length - 1];
      const attestationId = attestation._id.toString();

      const pdfBytes = await renderCertificatePdf({
        volunteerName: `${volunteer.prenom} ${volunteer.nom}`,
        programTitle: program.title,
        referenceCode: attestationId.slice(-8).toUpperCase(),
        qrUrl: `https://ampbenin.netlify.app/verify/${attestationId}`,
      });

      const uploadedFile = await uploadFromBuffer(Buffer.from(pdfBytes), "attestations");

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
