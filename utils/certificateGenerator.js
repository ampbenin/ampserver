/**
 * Génération de l'image composite d'un certificat (fond fourni par le
 * programme + QR code + nom du volontaire + description, superposés aux
 * zones définies sur VolunteerProgram) — technique reprise du système de
 * tickets de server-miss-culture-benin (services/generate-ticket.js) :
 *
 * - Visuel SVG : le QR code et le texte sont injectés comme markup XML
 *   directement dans le source du SVG, juste avant </svg>, puis le SVG
 *   complet est rasterisé en une seule passe (sharp).
 * - Visuel raster (PNG/JPG) : un raster n'a aucune structure XML dans
 *   laquelle injecter du markup — chaque zone est donc rendue comme un
 *   calque PNG indépendant (le QR code directement ; le texte via un
 *   mini-SVG converti en PNG, car sharp ne sait pas dessiner de texte
 *   nativement), puis superposée sur le fond via sharp().composite().
 *
 * Retourne toujours un buffer PNG — c'est à l'appelant (certificateController.js)
 * de l'embarquer dans le PDF final (pdf-lib), le certificat restant un vrai
 * document PDF imprimable malgré ce nouveau mode de génération du visuel.
 */
const sharp = require("sharp");

// fetch natif (Node 18+, disponible ici) plutôt qu'ajouter axios comme
// nouvelle dépendance — ce backend ne l'a pas contrairement à celui des votes.
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Échec du téléchargement du visuel (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Découpe en lignes tenant dans maxWidth — approximation simple (largeur de
// caractère moyenne), suffisante pour une description courte sur un
// certificat ; contrairement au ticket, pas de police embarquée ici pour
// mesurer précisément (le texte est rendu par le moteur SVG du navigateur/
// resvg au moment de la rasterisation, pas par un objet Font en mémoire).
function wrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (trial.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

// Construit les valeurs texte disponibles pour les zones connues.
function buildZoneTextValues({ volunteerName, description }) {
  return { nom: volunteerName || "", description: description || "" };
}

/* -------------------- Chemin SVG (injection XML) -------------------- */

function buildTextElement(zone, value) {
  const fontSize = zone.fontSize || 24;
  const color = zone.color || "#000000";
  // Description : texte potentiellement plus long, découpé sur plusieurs
  // lignes (largeur approximée à 1.8 caractère par unité de fontSize dans
  // la zone). Nom : toujours une seule ligne.
  if (zone.nom === "description") {
    const approxCharsPerLine = Math.max(6, Math.floor(zone.width / (fontSize * 0.55)));
    const approxMaxLines = Math.max(1, Math.floor(zone.height / (fontSize * 1.3)));
    const lines = wrapText(value, approxCharsPerLine, approxMaxLines);
    const lineHeight = fontSize * 1.3;
    return lines
      .map((line, i) => {
        const y = zone.y + fontSize + i * lineHeight;
        return `<text x="${zone.x + zone.width / 2}" y="${y}" font-size="${fontSize}" fill="${color}" font-family="Arial, sans-serif" text-anchor="middle">${escapeXml(line)}</text>`;
      })
      .join("\n");
  }
  const textY = zone.y + zone.height / 2 + fontSize * 0.35;
  return `<text x="${zone.x + zone.width / 2}" y="${textY}" font-size="${fontSize}" fill="${color}" font-family="Arial, sans-serif" text-anchor="middle">${escapeXml(value)}</text>`;
}

async function buildZoneElementsSvg(zones, qrDataUri, textValues) {
  const elements = [];
  for (const zone of zones) {
    if (zone.nom === "qr") {
      elements.push(
        `<image href="${qrDataUri}" x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" preserveAspectRatio="xMidYMid meet" />`
      );
      continue;
    }
    if (zone.nom in textValues) {
      elements.push(buildTextElement(zone, textValues[zone.nom]));
    }
  }
  return elements.join("\n");
}

function injectElementsBeforeClosingTag(svgText, elementsMarkup) {
  const closingTagIndex = svgText.lastIndexOf("</svg>");
  if (closingTagIndex === -1) throw new Error("SVG invalide : balise </svg> introuvable");
  return svgText.slice(0, closingTagIndex) + elementsMarkup + "\n" + svgText.slice(closingTagIndex);
}

function extractSvgWidth(svgText) {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBoxMatch) return parseFloat(viewBoxMatch[1]);
  const widthMatch = svgText.match(/\swidth\s*=\s*["']([\d.]+)/i);
  if (widthMatch) return parseFloat(widthMatch[1]);
  return 1000;
}

const TARGET_WIDTH_PX = 2000;

async function generateFromSvgTemplate(templateUrl, zones, qrDataUri, textValues) {
  const svgText = (await fetchBuffer(templateUrl)).toString("utf-8");

  const elementsMarkup = await buildZoneElementsSvg(zones, qrDataUri, textValues);
  const finalSvg = injectElementsBeforeClosingTag(svgText, elementsMarkup);

  const svgWidth = extractSvgWidth(finalSvg);
  const density = Math.max(72, Math.ceil((TARGET_WIDTH_PX / svgWidth) * 96));

  return sharp(Buffer.from(finalSvg), { density }).png().toBuffer();
}

/* -------------------- Chemin raster (composite de calques) -------------------- */

async function buildTextZonePng(value, zone) {
  const width = Math.max(1, Math.round(zone.width));
  const height = Math.max(1, Math.round(zone.height));
  const fontSize = zone.fontSize || 24;
  const color = zone.color || "#000000";

  let svgContent;
  if (zone.nom === "description") {
    const approxCharsPerLine = Math.max(6, Math.floor(width / (fontSize * 0.55)));
    const approxMaxLines = Math.max(1, Math.floor(height / (fontSize * 1.3)));
    const lines = wrapText(value, approxCharsPerLine, approxMaxLines);
    const lineHeight = fontSize * 1.3;
    svgContent = lines
      .map((line, i) => `<text x="${width / 2}" y="${fontSize + i * lineHeight}" font-size="${fontSize}" fill="${color}" font-family="Arial, sans-serif" text-anchor="middle">${escapeXml(line)}</text>`)
      .join("\n");
  } else {
    const textY = height / 2 + fontSize * 0.35;
    svgContent = `<text x="${width / 2}" y="${textY}" font-size="${fontSize}" fill="${color}" font-family="Arial, sans-serif" text-anchor="middle">${escapeXml(value)}</text>`;
  }

  const snippet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svgContent}</svg>`;
  return sharp(Buffer.from(snippet)).png().toBuffer();
}

async function generateFromRasterTemplate(templateUrl, zones, qrDataUri, textValues) {
  const baseBuffer = await fetchBuffer(templateUrl);

  const composites = [];
  const qrRawPng = Buffer.from(qrDataUri.split(",")[1], "base64");

  for (const zone of zones) {
    const left = Math.round(zone.x);
    const top = Math.round(zone.y);

    if (zone.nom === "qr") {
      const width = Math.max(1, Math.round(zone.width));
      const height = Math.max(1, Math.round(zone.height));
      const qrResized = await sharp(qrRawPng).resize(width, height).png().toBuffer();
      composites.push({ input: qrResized, left, top });
      continue;
    }
    if (zone.nom in textValues) {
      const textPng = await buildTextZonePng(textValues[zone.nom], zone);
      composites.push({ input: textPng, left, top });
    }
  }

  let pipeline = sharp(baseBuffer);
  if (composites.length) pipeline = pipeline.composite(composites);
  return pipeline.png().toBuffer();
}

/* -------------------- Point d'entrée -------------------- */

/**
 * @param {object} program - document VolunteerProgram (certificateTemplateUrl,
 *   certificateTemplateFormat, certificateZones requis).
 * @param {string} volunteerName - nom complet à afficher.
 * @param {string} description - texte de la zone "description" (déjà résolu
 *   par l'appelant : program.certificateDescription).
 * @param {string} qrUrl - URL encodée dans le QR code (page de vérification).
 * @returns {Promise<Buffer>} PNG composite prêt à être embarqué dans un PDF.
 */
async function generateCertificateImage(program, volunteerName, description, qrUrl) {
  if (!program.certificateTemplateUrl) {
    throw new Error("Aucun visuel de certificat configuré pour ce programme");
  }

  const QRCode = require("qrcode");
  const qrDataUri = await QRCode.toDataURL(qrUrl, { margin: 1, width: 512 });

  const zones = program.certificateZones || [];
  const textValues = buildZoneTextValues({ volunteerName, description });
  const templateFormat = program.certificateTemplateFormat || "svg";

  return templateFormat === "raster"
    ? generateFromRasterTemplate(program.certificateTemplateUrl, zones, qrDataUri, textValues)
    : generateFromSvgTemplate(program.certificateTemplateUrl, zones, qrDataUri, textValues);
}

module.exports = { generateCertificateImage };
