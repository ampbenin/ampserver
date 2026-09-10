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

const DESCRIPTION_FONT_FAMILY = "Arial, sans-serif";

// Mesure la largeur réelle (en px) d'un texte tel que rendu par CE moteur de
// rasterisation — rendu isolé dans un SVG jetable puis recadré (sharp.trim())
// à la boîte englobante du texte. Nécessaire car ni `word-spacing` ni
// `textLength`/`lengthAdjust` (les deux essayés d'abord) ne sont respectés
// ici : vérifié empiriquement (rendu strictement identique avec ou sans ces
// attributs) — seule une mesure/positionnement basés sur de vrais glyphes
// fonctionne de façon fiable.
async function measureTextWidth(text, fontSize, fontFamily, fontWeight = "normal") {
  if (!text) return 0;
  const probeHeight = Math.ceil(fontSize * 1.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${probeHeight}"><text x="0" y="${fontSize}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}">${escapeXml(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
  return info.width;
}

const spaceWidthCache = new Map();
async function getSpaceWidth(fontSize, bold) {
  const key = `${fontSize}|${bold}`;
  if (!spaceWidthCache.has(key)) {
    const fw = bold ? "bold" : "normal";
    const withSpace = await measureTextWidth("I I", fontSize, DESCRIPTION_FONT_FAMILY, fw);
    const withoutSpace = await measureTextWidth("II", fontSize, DESCRIPTION_FONT_FAMILY, fw);
    spaceWidthCache.set(key, Math.max(1, withSpace - withoutSpace));
  }
  return spaceWidthCache.get(key);
}

/* ---------- Éditeur riche (Description certificat, admin) — parsing ---------- */
// Le champ "Description certificat" est désormais un éditeur riche côté
// admin (gras, souligné, couleur, taille, alignement — voir
// VolunteerProgramEditor.jsx) qui enregistre du HTML. Ce parseur ne gère
// QU'un sous-ensemble volontairement restreint (les seules balises que cet
// éditeur peut produire : <b>/<strong>, <u>, <span style="...">, <div>/<p>
// pour les paragraphes, <br>) — pas un parseur HTML générique. Les valeurs
// enregistrées AVANT cette fonctionnalité (texte brut, éventuellement avec
// des \n) restent supportées via paragraphsFromPlainText ci-dessous.

function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeAlign(val) {
  const v = String(val || "").toLowerCase();
  if (v.includes("center")) return "center";
  if (v.includes("right") || v === "end") return "right";
  if (v.includes("justify")) return "justify";
  return "left";
}

function parseInlineStyle(styleAttr) {
  const style = {};
  String(styleAttr || "")
    .split(";")
    .forEach((decl) => {
      const [rawKey, ...rest] = decl.split(":");
      const rawVal = rest.join(":");
      if (!rawKey || !rawVal) return;
      const key = rawKey.trim().toLowerCase();
      const val = rawVal.trim();
      if (key === "color") style.color = val;
      if (key === "text-align") style.align = normalizeAlign(val);
      if (key === "font-weight" && (val === "bold" || parseInt(val, 10) >= 600)) style.bold = true;
      if (key === "text-decoration" && val.includes("underline")) style.underline = true;
      if (key === "font-size") {
        const m = val.match(/([\d.]+)px/);
        if (m) style.fontSize = parseFloat(m[1]);
      }
    });
  return style;
}

// Sépare le HTML en paragraphes de "mots stylés" : [{ align, words: [{text,
// bold, underline, color, fontSize}] }, ...].
function parseRichDescription(html) {
  const paragraphs = [];
  const blocks = String(html).split(/<\/(?:p|div)\s*>|<br\s*\/?>/i);

  for (const rawBlock of blocks) {
    const blockOpenMatch = rawBlock.match(/^\s*<(p|div)([^>]*)>/i);
    let align = "left";
    let content = rawBlock;
    if (blockOpenMatch) {
      const styleAttrMatch = blockOpenMatch[2].match(/style\s*=\s*"([^"]*)"/i);
      if (styleAttrMatch) {
        const style = parseInlineStyle(styleAttrMatch[1]);
        if (style.align) align = style.align;
      }
      content = rawBlock.slice(blockOpenMatch[0].length);
    }

    const words = [];
    const styleStack = [{ bold: false, underline: false, color: null, fontSize: null }];
    const tagRe = /<(\/?)(\w+)([^>]*)>/g;
    let lastIndex = 0;
    let match;

    const flushText = (text) => {
      if (!text) return;
      const current = styleStack[styleStack.length - 1];
      const decoded = decodeHtmlEntities(text).replace(/\s+/g, " ");
      decoded
        .split(" ")
        .filter(Boolean)
        .forEach((w) => words.push({ text: w, ...current }));
    };

    while ((match = tagRe.exec(content)) !== null) {
      const [full, closing, tagNameRaw, attrs] = match;
      flushText(content.slice(lastIndex, match.index));
      lastIndex = tagRe.lastIndex;
      const tag = tagNameRaw.toLowerCase();

      if (closing) {
        if (["b", "strong", "u", "span", "font"].includes(tag) && styleStack.length > 1) styleStack.pop();
        continue;
      }
      if (full.endsWith("/>") && tag !== "br") continue; // balise auto-fermante non gérée (image collée...)

      const top = styleStack[styleStack.length - 1];
      if (tag === "b" || tag === "strong") {
        styleStack.push({ ...top, bold: true });
      } else if (tag === "u") {
        styleStack.push({ ...top, underline: true });
      } else if (tag === "span" || tag === "font") {
        const styleAttrMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
        const s = styleAttrMatch ? parseInlineStyle(styleAttrMatch[1]) : {};
        styleStack.push({
          bold: s.bold || top.bold,
          underline: s.underline || top.underline,
          color: s.color || top.color,
          fontSize: s.fontSize || top.fontSize,
        });
      }
    }
    flushText(content.slice(lastIndex));

    if (words.length) paragraphs.push({ align, words });
  }

  return paragraphs;
}

// Repli pour les valeurs enregistrées avant l'éditeur riche : texte brut,
// paragraphes séparés par des retours à la ligne — même comportement
// qu'avant (justifié, sans style particulier).
function paragraphsFromPlainText(text) {
  return String(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      align: "justify",
      words: p
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ text: w, bold: false, underline: false, color: null, fontSize: null })),
    }));
}

function hasVisibleText(raw) {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .trim().length > 0;
}

/* ---------- Éditeur riche — mise en page (wrap + justification) ---------- */

// Découpe les mots d'UN paragraphe en lignes tenant dans zone.width, à
// l'échelle `scale` (utilisée pour réduire proportionnellement toutes les
// tailles — y compris les tailles personnalisées par mot — si le texte ne
// tient pas dans la hauteur disponible).
async function wrapParagraphWords(words, zone, scale) {
  const baseFontSize = zone.fontSize || 32;
  const lines = [];
  let current = [];
  let currentWidth = 0;
  let currentMaxFont = 0;

  for (const word of words) {
    const fontSize = (word.fontSize || baseFontSize) * scale;
    const bold = !!word.bold;
    const width = await measureTextWidth(word.text, fontSize, DESCRIPTION_FONT_FAMILY, bold ? "bold" : "normal");
    const spaceW = await getSpaceWidth(fontSize, bold);
    const prospectiveGap = current.length ? spaceW : 0;

    if (currentWidth + prospectiveGap + width > zone.width && current.length) {
      lines.push({ words: current, maxFont: currentMaxFont });
      current = [];
      currentWidth = 0;
      currentMaxFont = 0;
    }

    const gap = current.length ? spaceW : 0;
    current.push({
      text: word.text,
      bold,
      underline: !!word.underline,
      color: word.color || zone.color || "#000000",
      fontSize,
      width,
    });
    currentWidth += gap + width;
    currentMaxFont = Math.max(currentMaxFont, fontSize);
  }
  if (current.length) lines.push({ words: current, maxFont: currentMaxFont });
  return lines;
}

// Place toutes les lignes de tous les paragraphes verticalement, avec un
// petit interligne SUPPLÉMENTAIRE entre paragraphes (demande explicite) en
// plus de l'interligne normal entre lignes d'un même paragraphe. Réduit
// `scale` par itérations si le texte ne tient pas dans zone.height, au lieu
// de tronquer — c'est ce qui garantit que plusieurs paragraphes restent
// tous visibles.
async function layoutRichDescription(paragraphs, zone) {
  const baseFontSize = zone.fontSize || 32;

  async function attempt(scale) {
    const paragraphGap = baseFontSize * scale * 0.55;
    const lines = [];
    let cursorY = zone.y;

    for (let p = 0; p < paragraphs.length; p++) {
      const paraLines = await wrapParagraphWords(paragraphs[p].words, zone, scale);
      paraLines.forEach((line, idx) => {
        const baseline = cursorY + line.maxFont;
        lines.push({
          align: paragraphs[p].align,
          words: line.words,
          y: baseline,
          isParagraphEnd: idx === paraLines.length - 1,
        });
        cursorY += line.maxFont * 1.3;
      });
      if (p < paragraphs.length - 1) cursorY += paragraphGap;
    }

    return { lines, totalHeight: cursorY - zone.y };
  }

  let scale = 1;
  let result = await attempt(scale);
  for (let i = 0; i < 5 && result.totalHeight > zone.height && scale > 0.35; i++) {
    const ratio = zone.height / result.totalHeight;
    scale = Math.max(0.35, scale * ratio * 0.95);
    result = await attempt(scale);
  }
  return result;
}

function wordTspanAttrs(word) {
  return [
    `font-size="${word.fontSize.toFixed(1)}"`,
    `font-weight="${word.bold ? "bold" : "normal"}"`,
    `fill="${word.color}"`,
    word.underline ? `text-decoration="underline"` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// Rend les lignes déjà positionnées : justifié = un <tspan x=".."> par mot
// (seule technique fiable ici, voir measureTextWidth) ; gauche/centre/droite
// = flux naturel dans un seul <text> ancré (text-anchor), plus simple et
// suffisant puisqu'aucun étirement n'est nécessaire dans ces cas.
function buildRichDescriptionMarkup(layout, zone) {
  const parts = [];

  for (const line of layout.lines) {
    if (!line.words.length) continue;
    const isJustify = line.align === "justify" && !line.isParagraphEnd && line.words.length > 1;

    if (isJustify) {
      const totalWordsWidth = line.words.reduce((s, w) => s + w.width, 0);
      const gapWidth = Math.max(4, (zone.width - totalWordsWidth) / (line.words.length - 1));
      let cursorX = zone.x;
      const tspans = line.words.map((w) => {
        const markup = `<tspan x="${cursorX.toFixed(1)}" y="${line.y.toFixed(1)}" ${wordTspanAttrs(w)}>${escapeXml(w.text)}</tspan>`;
        cursorX += w.width + gapWidth;
        return markup;
      });
      parts.push(`<text>${tspans.join("")}</text>`);
      continue;
    }

    let anchorX = zone.x;
    let textAnchor = "start";
    if (line.align === "center") {
      anchorX = zone.x + zone.width / 2;
      textAnchor = "middle";
    } else if (line.align === "right") {
      anchorX = zone.x + zone.width;
      textAnchor = "end";
    }

    const tspans = line.words.map((w, i) => {
      const prefix = i > 0 ? " " : "";
      return `<tspan ${wordTspanAttrs(w)}>${escapeXml(prefix + w.text)}</tspan>`;
    });
    // xml:space="preserve" est INDISPENSABLE ici : par défaut, ce moteur de
    // rendu rogne les espaces en début/fin de contenu de CHAQUE <tspan>
    // (vérifié empiriquement) — sans ça, l'espace ajouté en préfixe de
    // chaque mot (nécessaire pour changer de style par mot) disparaît et
    // tous les mots de la ligne se retrouvent collés.
    parts.push(`<text x="${anchorX.toFixed(1)}" y="${line.y.toFixed(1)}" text-anchor="${textAnchor}" xml:space="preserve">${tspans.join("")}</text>`);
  }

  return parts.join("\n");
}

// Point d'entrée de la zone "description" — utilisé par les deux chemins
// (SVG absolu / raster local à 0,0, voir zone passée par l'appelant).
// Retourne une chaîne vide si le champ est vide : le certificat n'affiche
// alors rien dans cette zone (pas de texte de repli).
async function renderDescriptionZone(rawValue, zone) {
  if (!hasVisibleText(rawValue)) return "";

  const isHtml = /<[a-z][\s\S]*>/i.test(String(rawValue));
  const paragraphs = isHtml ? parseRichDescription(rawValue) : paragraphsFromPlainText(rawValue);
  if (!paragraphs.length) return "";

  const layout = await layoutRichDescription(paragraphs, zone);
  return buildRichDescriptionMarkup(layout, zone);
}

// Construit les valeurs texte disponibles pour les zones connues.
function buildZoneTextValues({ volunteerName, description }) {
  return { nom: volunteerName || "", description: description || "" };
}

/* -------------------- Chemin SVG (injection XML) -------------------- */

// Police "élégante" pour le nom — empattement (serif) + gras, pour ressortir
// visuellement du reste du texte (demande explicite). Repli sur des polices
// serif largement disponibles côté serveur (le rendu SVG n'a pas accès aux
// polices custom du poste de conception) : si "Playfair Display" n'est pas
// installée sur le serveur, le moteur de rendu retombe sur Georgia puis sur
// le serif générique du système — reste élégant dans tous les cas.
const NOM_FONT_FAMILY = "'Playfair Display', Georgia, 'Times New Roman', serif";
const NOM_DEFAULT_COLOR = "#1B4332"; // vert sombre — identité visuelle AMP Bénin

async function buildTextElement(zone, value) {
  const fontSize = zone.fontSize || 24;
  const color = zone.color || "#000000";

  // Description : HTML riche (gras/souligné/couleur/taille/alignement,
  // saisis depuis l'admin) ou texte brut legacy, multi-paragraphes, avec
  // interligne supplémentaire entre paragraphes et taille auto-réduite si
  // besoin pour que TOUT le texte tienne (voir renderDescriptionZone) — vide
  // si le champ est vide, aucun texte de repli.
  if (zone.nom === "description") {
    return renderDescriptionZone(value, zone);
  }

  // "nom" : gras, police élégante, vert sombre par défaut (surchargeable via
  // zone.color). Toute autre zone texte simple garde le rendu neutre.
  const isNom = zone.nom === "nom";
  const textColor = isNom ? zone.color || NOM_DEFAULT_COLOR : color;
  const fontFamily = isNom ? NOM_FONT_FAMILY : "Arial, sans-serif";
  const fontWeight = isNom ? "bold" : "normal";
  const textY = zone.y + zone.height / 2 + fontSize * 0.35;
  return `<text x="${zone.x + zone.width / 2}" y="${textY}" font-size="${fontSize}" fill="${textColor}" font-family="${fontFamily}" font-weight="${fontWeight}" text-anchor="middle">${escapeXml(value)}</text>`;
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
    // Description vide (champ non rempli côté admin) : on ne dessine rien
    // du tout dans cette zone, pas de texte de repli.
    if (zone.nom === "description" && !hasVisibleText(textValues.description)) continue;
    if (zone.nom in textValues) {
      elements.push(await buildTextElement(zone, textValues[zone.nom]));
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
    // Origine (0,0) locale à ce calque, contrairement au chemin SVG (qui
    // travaille dans les coordonnées absolues du visuel).
    svgContent = await renderDescriptionZone(value, { x: 0, y: 0, width, height, fontSize: zone.fontSize, color: zone.color });
  } else {
    const isNom = zone.nom === "nom";
    const textColor = isNom ? zone.color || NOM_DEFAULT_COLOR : color;
    const fontFamily = isNom ? NOM_FONT_FAMILY : "Arial, sans-serif";
    const fontWeight = isNom ? "bold" : "normal";
    const textY = height / 2 + fontSize * 0.35;
    svgContent = `<text x="${width / 2}" y="${textY}" font-size="${fontSize}" fill="${textColor}" font-family="${fontFamily}" font-weight="${fontWeight}" text-anchor="middle">${escapeXml(value)}</text>`;
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
    if (zone.nom === "description" && !hasVisibleText(textValues.description)) continue;
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
