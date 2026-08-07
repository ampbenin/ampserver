/**
 * Génération du PDF "Rapport d'impact" téléchargeable depuis le tableau de
 * bord PARTENAIRE (voir controllers/volunteerProgramPartnerController.js
 * #downloadImpactReport). Construit un document A4 multi-page avec pdf-lib
 * (pas de dépendance supplémentaire), reprenant TOUTES les sections déjà
 * visibles par le partenaire sur son tableau de bord — chiffres clés,
 * progression dans le temps (mini bar chart dessiné à la main), liste des
 * bénéficiaires (optionnelle, jamais les rejetés), volontaires à mission
 * validée et le détail de leurs tâches approuvées, aperçu en images, et ses
 * échanges avec l'équipe.
 *
 * Refonte du 2026-08-07 (v2, sur demande explicite de l'utilisateur) :
 * - En-tête avec DEUX logos (AMP BENIN + partenaire) et pied de page avec
 *   la bannière "Barre des partenaires", répétés sur CHAQUE page (pas
 *   seulement la première) — géré par ReportCursor#addPage, qui redessine
 *   ces bandes à chaque nouvelle page.
 * - Le titre du programme est maintenant enroulé sur plusieurs lignes
 *   (wrapText) au lieu d'un unique drawText qui pouvait déborder hors page
 *   sur un titre long (bug signalé : "le titre est coupé").
 *   la section "Candidatures reçues" est renommée "Liste des bénéficiaires
 *   directs et indirects" (PENDING → "Bénéficiaire indirect", ACCEPTED →
 *   "Bénéficiaire"), et devient optionnelle : absente du rapport complet
 *   par défaut (includeBeneficiaries), ou seule section d'un PDF allégé
 *   dédié (onlyBeneficiaries) — voir le contrôleur pour les query params.
 */

const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

const PAGE_WIDTH = 595.28; // A4 portrait, en points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Bande d'en-tête (logos AMP BENIN + partenaire) — répétée sur chaque page.
const TOP_LOGO_H = 28;
// Bande de pied de page (barre des partenaires + texte de génération) —
// répétée sur chaque page. Répartition verticale (du haut vers le bas de
// la bande) : règle → barre des partenaires (max BOTTOM_BAR_MAX_H) → texte
// de génération/numérotation — chaque élément avec assez de marge pour ne
// jamais se chevaucher même quand la barre est à sa hauteur maximale.
const BOTTOM_BAR_MAX_H = 24;
const BOTTOM_BAND_H = 70; // hauteur totale réservée en bas (barre + règle + texte)

const COLORS = {
  primary: rgb(0x1b / 255, 0x43 / 255, 0x32 / 255),
  primaryLight: rgb(0x2d / 255, 0x6a / 255, 0x4f / 255),
  primaryBg: rgb(0xe8 / 255, 0xf5 / 255, 0xef / 255),
  accent: rgb(0xc9 / 255, 0x90 / 255, 0x3a / 255),
  accentBg: rgb(0xfd / 255, 0xf4 / 255, 0xe7 / 255),
  text: rgb(0.1, 0.1, 0.1),
  textSec: rgb(0.29, 0.29, 0.29),
  gray: rgb(0.45, 0.45, 0.45),
  border: rgb(0.86, 0.85, 0.81),
  white: rgb(1, 1, 1),
  success: rgb(0x40 / 255, 0x89 / 255, 0x6c / 255),
};

// StandardFonts (WinAnsi/Windows-1252) ne couvre que le Latin-1 étendu — un
// emoji ou tout caractère hors de cette plage fait planter drawText()
// (constaté en pratique avec 📍 pendant les tests initiaux). Filtre
// défensif appliqué à tout texte pouvant venir de la base (titres, noms,
// commentaires libres...) plutôt que de ne sécuriser que les chaînes en dur.
function toWinAnsiSafe(text) {
  return [...String(text ?? "")].filter((ch) => ch.codePointAt(0) <= 0xff).join("");
}

function wrapText(text, font, size, maxWidth) {
  const words = toWinAnsiSafe(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateToWidth(text, font, size, maxWidth) {
  const safe = toWinAnsiSafe(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

// Récupère et intègre une image distante au document — jamais bloquant :
// une image manquante/inaccessible se traduit juste par une absence
// silencieuse (le logo/la bannière ne s'affiche pas), jamais un PDF cassé.
async function embedImageSafe(pdfDoc, url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "";
    return contentType.includes("png") ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch (err) {
    console.error("⚠️ Image non intégrée au rapport PDF :", err.message);
    return null;
  }
}

// Curseur de mise en page : gère la position Y courante, le changement de
// page automatique — CHAQUE page (y compris la première) reçoit la bande
// d'en-tête (logos) et la bande de pied de page (barre des partenaires),
// dessinées une fois par embedded image et réutilisées telles quelles sur
// toutes les pages (pdf-lib permet de dessiner la même image intégrée
// plusieurs fois sans la re-télécharger/re-intégrer).
class ReportCursor {
  constructor(pdfDoc, fonts, programTitle, images) {
    this.pdfDoc = pdfDoc;
    this.font = fonts.font;
    this.fontBold = fonts.fontBold;
    this.fontItalic = fonts.fontItalic;
    this.programTitle = programTitle;
    this.images = images || {};
    this.page = null;
    this.y = 0;
    this.addPage(true);
  }

  addPage(isFirst = false) {
    this.page = this.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this._drawHeaderBand(isFirst);
    this._drawFooterBand();
  }

  _drawHeaderBand(isFirst) {
    const top = PAGE_HEIGHT - MARGIN;
    const h = TOP_LOGO_H;

    if (this.images.ampLogo) {
      const img = this.images.ampLogo;
      const w = (img.width / img.height) * h;
      this.page.drawImage(img, { x: MARGIN, y: top - h, width: w, height: h });
    }
    if (this.images.partnerLogo) {
      const img = this.images.partnerLogo;
      const w = (img.width / img.height) * h;
      this.page.drawImage(img, { x: PAGE_WIDTH - MARGIN - w, y: top - h, width: w, height: h });
    }

    const ruleY = top - h - 8;
    this.page.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: PAGE_WIDTH - MARGIN, y: ruleY }, thickness: 0.75, color: COLORS.border });

    if (!isFirst) {
      this.page.drawText(toWinAnsiSafe(`AMP BENIN · ${this.programTitle} (suite)`), {
        x: MARGIN, y: ruleY - 12, size: 8.5, font: this.font, color: COLORS.gray,
      });
      this.y = ruleY - 26;
    } else {
      this.y = ruleY - 16;
    }
  }

  _drawFooterBand() {
    const ruleY = MARGIN + BOTTOM_BAND_H - 14;
    this.page.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: PAGE_WIDTH - MARGIN, y: ruleY }, thickness: 0.5, color: COLORS.border });

    if (this.images.partnersBar) {
      const img = this.images.partnersBar;
      const scale = Math.min(CONTENT_WIDTH / img.width, BOTTOM_BAR_MAX_H / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = MARGIN + (CONTENT_WIDTH - w) / 2;
      const y = ruleY - h - 6;
      this.page.drawImage(img, { x, y, width: w, height: h });
    }
    // Le texte "généré le ... — page X/Y" est ajouté en passe finale, une
    // fois le nombre total de pages connu (voir buildPartnerImpactReportPdf) —
    // dessiné tout en bas de la bande (voir footerTextY), donc toujours en
    // dessous de la barre des partenaires même à sa hauteur maximale
    // (ruleY - 6 - BOTTOM_BAR_MAX_H = MARGIN + 70 - 14 - 6 - 24 = MARGIN + 26,
    // largement au-dessus de footerTextY = MARGIN + 12).
  }

  ensureSpace(height) {
    if (this.y - height < MARGIN + BOTTOM_BAND_H) this.addPage(false);
  }

  sectionTitle(text) {
    this.ensureSpace(28);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 3, width: 4, height: 13, color: COLORS.accent });
    this.page.drawText(toWinAnsiSafe(text), { x: MARGIN + 10, y: this.y, size: 12.5, font: this.fontBold, color: COLORS.primary });
    this.y -= 22;
  }

  paragraph(text, { size = 10, color = COLORS.textSec, font, lineHeight, italic = false } = {}) {
    const useFont = font || (italic ? this.fontItalic : this.font);
    const lh = lineHeight || size + 4;
    const lines = wrapText(text, useFont, size, CONTENT_WIDTH);
    lines.forEach((line) => {
      this.ensureSpace(lh);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: useFont, color });
      this.y -= lh;
    });
  }

  bullet(text, { size = 9.5, indent = 6 } = {}) {
    const lines = wrapText(text, this.font, size, CONTENT_WIDTH - indent - 10);
    lines.forEach((line, i) => {
      this.ensureSpace(size + 5);
      this.page.drawText(i === 0 ? `•  ${line}` : `    ${line}`, { x: MARGIN + indent, y: this.y, size, font: this.font, color: COLORS.text });
      this.y -= size + 5;
    });
  }

  spacer(h = 10) { this.y -= h; }

  divider() {
    this.ensureSpace(14);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 0.5, color: COLORS.border });
    this.y -= 14;
  }

  // Titre principal — enroulé sur autant de lignes que nécessaire (jamais
  // tronqué/débordant, contrairement à la v1 qui dessinait le titre en un
  // seul drawText, débordant hors page sur un titre long).
  title(text, { size = 19 } = {}) {
    const lines = wrapText(text, this.fontBold, size, CONTENT_WIDTH);
    lines.forEach((line) => {
      this.ensureSpace(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fontBold, color: COLORS.primary });
      this.y -= size + 4;
    });
  }

  // Grille de statistiques façon "cartes" du dashboard — items: [{label, value}]
  statGrid(items) {
    const gap = 10;
    const boxW = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length;
    const boxH = 60;
    this.ensureSpace(boxH + 10);
    const topY = this.y;
    items.forEach((item, i) => {
      const x = MARGIN + i * (boxW + gap);
      this.page.drawRectangle({ x, y: topY - boxH, width: boxW, height: boxH, color: COLORS.primaryBg, borderColor: COLORS.border, borderWidth: 0.75 });
      this.page.drawRectangle({ x, y: topY - 3, width: boxW, height: 3, color: COLORS.accent });
      const valueText = toWinAnsiSafe(String(item.value));
      const valueSize = 15;
      const valueWidth = this.fontBold.widthOfTextAtSize(valueText, valueSize);
      this.page.drawText(valueText, { x: x + Math.max(4, (boxW - valueWidth) / 2), y: topY - 27, size: valueSize, font: this.fontBold, color: COLORS.primary });
      const labelText = toWinAnsiSafe(item.label);
      const labelSize = 7;
      const labelWidth = this.font.widthOfTextAtSize(labelText, labelSize);
      this.page.drawText(labelText, { x: x + Math.max(4, (boxW - labelWidth) / 2), y: topY - boxH + 11, size: labelSize, font: this.font, color: COLORS.textSec });
    });
    this.y = topY - boxH - 18;
  }

  // Mini bar chart pour "Progression dans le temps" — data: [{label, count}]
  barChart(data, { height = 120 } = {}) {
    if (!data || data.length === 0) {
      this.paragraph("Pas encore assez de données pour afficher un graphique.", { size: 9.5, color: COLORS.gray, italic: true });
      return;
    }
    this.ensureSpace(height + 46);
    const chartTop = this.y;
    const chartBottom = chartTop - height;
    const maxCount = Math.max(...data.map((d) => d.count), 1);
    const gap = 10;
    const barW = Math.min(38, (CONTENT_WIDTH - gap * (data.length - 1)) / data.length);
    const totalW = barW * data.length + gap * (data.length - 1);
    const startX = MARGIN + Math.max(0, (CONTENT_WIDTH - totalW) / 2);

    this.page.drawLine({ start: { x: MARGIN, y: chartBottom }, end: { x: PAGE_WIDTH - MARGIN, y: chartBottom }, thickness: 0.75, color: COLORS.border });

    data.forEach((d, i) => {
      const barH = Math.max((d.count / maxCount) * (height - 22), d.count > 0 ? 2 : 0);
      const x = startX + i * (barW + gap);
      this.page.drawRectangle({ x, y: chartBottom, width: barW, height: barH, color: COLORS.primary });
      const countText = String(d.count);
      const countWidth = this.font.widthOfTextAtSize(countText, 7.5);
      this.page.drawText(countText, { x: x + Math.max(0, (barW - countWidth) / 2), y: chartBottom + barH + 4, size: 7.5, font: this.font, color: COLORS.primaryLight });
      this.page.drawText(toWinAnsiSafe(d.label), {
        x: x + barW / 2, y: chartBottom - 10, size: 7, font: this.font, color: COLORS.gray, rotate: degrees(-40),
      });
    });

    this.y = chartBottom - 34;
  }

  // Tableau zébré avec en-tête répété automatiquement sur les nouvelles
  // pages. columns: [{label, width, key, color?: (row) => Color}]
  table(columns, rows, { rowHeight = 17 } = {}) {
    const drawHeader = () => {
      this.ensureSpace(rowHeight + 4);
      this.page.drawRectangle({ x: MARGIN, y: this.y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: COLORS.primary });
      let cx = MARGIN + 6;
      columns.forEach((col) => {
        this.page.drawText(toWinAnsiSafe(col.label), { x: cx, y: this.y - rowHeight + 5.5, size: 7.5, font: this.fontBold, color: COLORS.white });
        cx += col.width;
      });
      this.y -= rowHeight;
    };

    drawHeader();

    rows.forEach((row, idx) => {
      if (this.y - rowHeight < MARGIN + BOTTOM_BAND_H) {
        this.addPage(false);
        drawHeader();
      }
      if (idx % 2 === 1) {
        this.page.drawRectangle({ x: MARGIN, y: this.y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: COLORS.primaryBg });
      }
      let x = MARGIN + 6;
      columns.forEach((col) => {
        const raw = row[col.key];
        const display = raw === undefined || raw === null || raw === "" ? "—" : String(raw);
        const val = truncateToWidth(display, this.font, 8, col.width - 10);
        const color = col.color ? col.color(row) : COLORS.text;
        this.page.drawText(val, { x, y: this.y - rowHeight + 5.5, size: 8, font: this.font, color });
        x += col.width;
      });
      this.y -= rowHeight;
    });
    this.spacer(12);
  }

  // Grille d'images (aperçu galerie) — photos: [{url, caption}]. Async car
  // chaque image doit être récupérée par réseau puis intégrée au PDF.
  async imageGrid(photos, { cols = 3, cellSize = 145, gap = 15 } = {}) {
    for (let i = 0; i < photos.length; i += cols) {
      const rowPhotos = photos.slice(i, i + cols);
      this.ensureSpace(cellSize + 30);
      const rowTop = this.y;
      for (let c = 0; c < rowPhotos.length; c += 1) {
        const photo = rowPhotos[c];
        const x = MARGIN + c * (cellSize + gap);
        this.page.drawRectangle({ x, y: rowTop - cellSize, width: cellSize, height: cellSize, color: COLORS.primaryBg, borderColor: COLORS.border, borderWidth: 0.5 });
        const image = await embedImageSafe(this.pdfDoc, photo.url);
        if (image) {
          const scale = Math.min(cellSize / image.width, cellSize / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          this.page.drawImage(image, { x: x + (cellSize - w) / 2, y: rowTop - cellSize + (cellSize - h) / 2, width: w, height: h });
        }
        const caption = truncateToWidth(photo.caption, this.font, 6.5, cellSize);
        this.page.drawText(caption, { x, y: rowTop - cellSize - 11, size: 6.5, font: this.font, color: COLORS.gray });
      }
      this.y = rowTop - cellSize - 22;
    }
  }
}

function beneficiaryRows(applications) {
  return applications.map((a) => ({
    candidat: `${a.applicantFirstName || ""} ${a.applicantLastName || ""}`.trim(),
    email: a.applicantEmail,
    telephone: a.applicantPhone,
    status: a.status,
    // Renommage demandé par l'utilisateur (2026-08-07) : PENDING = pas
    // encore admis mais déjà en contact avec le programme ("bénéficiaire
    // indirect"), ACCEPTED = admis ("bénéficiaire").
    statutLabel: a.status === "ACCEPTED" ? "Bénéficiaire" : "Bénéficiaire indirect",
    date: a.createdAt ? new Date(a.createdAt).toLocaleDateString("fr-FR") : "",
  }));
}

function drawBeneficiariesSection(cursor, { applications, applicationsTotal }) {
  cursor.sectionTitle(`Liste des bénéficiaires directs et indirects (${applicationsTotal})`);
  if (applications.length === 0) {
    cursor.paragraph("Aucun bénéficiaire pour l'instant sur ce programme.", { size: 9.5, color: COLORS.gray, italic: true });
    return;
  }
  cursor.table(
    [
      { label: "NOM", width: 120, key: "candidat" },
      { label: "EMAIL", width: 150, key: "email" },
      { label: "TÉLÉPHONE", width: 75, key: "telephone" },
      // "Bénéficiaire indirect" mesure ~70pt à 8pt (Helvetica) — colonne
      // volontairement plus large que les autres pour ne jamais tronquer
      // ce libellé (constaté en test réel : 65pt le coupait en "…").
      { label: "STATUT", width: 95, key: "statutLabel", color: (row) => (row.status === "ACCEPTED" ? COLORS.success : COLORS.accent) },
      { label: "DATE", width: 55.28, key: "date" },
    ],
    beneficiaryRows(applications)
  );
  if (applicationsTotal > applications.length) {
    cursor.paragraph(
      `+ ${applicationsTotal - applications.length} autre(s) bénéficiaire(s), consultable(s) dans l'espace partenaire.`,
      { size: 8.5, color: COLORS.gray, italic: true }
    );
    cursor.spacer(6);
  }
}

/**
 * Construit le PDF complet et renvoie ses bytes.
 *
 * @param {object} data
 * @param {object} data.program        {title, description, location, startDate, endDate}
 * @param {object} data.partner        {name, partnerLogoUrl}
 * @param {string} data.ampLogoUrl            logo AMP BENIN (SiteSettings, admin)
 * @param {string} data.partnersBarImageUrl   bannière "Barre des partenaires" (SiteSettings, admin)
 * @param {object} [data.stats]        absent en mode onlyBeneficiaries
 * @param {Array}  [data.validatedVolunteers]  absent en mode onlyBeneficiaries
 * @param {Array}  [data.progressOverTime]     absent en mode onlyBeneficiaries
 * @param {Array}  data.applications   [{applicantFirstName, applicantLastName, applicantEmail, applicantPhone, status, createdAt}] — vide si ni includeBeneficiaries ni onlyBeneficiaries
 * @param {number} data.applicationsTotal
 * @param {Array}  [data.comments]     absent en mode onlyBeneficiaries
 * @param {object} data.options        {includeBeneficiaries, onlyBeneficiaries}
 */
async function buildPartnerImpactReportPdf(data) {
  const {
    program, partner, ampLogoUrl, partnersBarImageUrl, stats, validatedVolunteers, progressOverTime,
    applications, applicationsTotal, comments, options,
  } = data;
  const { includeBeneficiaries = false, onlyBeneficiaries = false } = options || {};

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Les 3 logos sont récupérés/intégrés UNE fois, puis redessinés sur
  // chaque page par ReportCursor (voir sa docstring) — jamais 3 allers-
  // retours réseau par page.
  const [ampLogo, partnerLogo, partnersBar] = await Promise.all([
    embedImageSafe(pdfDoc, ampLogoUrl),
    embedImageSafe(pdfDoc, partner?.partnerLogoUrl),
    embedImageSafe(pdfDoc, partnersBarImageUrl),
  ]);

  const cursor = new ReportCursor(pdfDoc, { font, fontBold, fontItalic }, program.title, { ampLogo, partnerLogo, partnersBar });

  const kicker = onlyBeneficiaries ? "AMP BENIN — Liste des bénéficiaires" : "AMP BENIN — Rapport d'impact partenaire";
  cursor.page.drawText(kicker, { x: MARGIN, y: cursor.y, size: 9.5, font, color: COLORS.gray });
  cursor.y -= 20;

  cursor.title(program.title);
  cursor.spacer(2);

  const infoLine = [
    program.location ? `Lieu : ${program.location}` : null,
    program.startDate ? `Début : ${new Date(program.startDate).toLocaleDateString("fr-FR")}` : null,
    program.endDate ? `Fin : ${new Date(program.endDate).toLocaleDateString("fr-FR")}` : null,
  ].filter(Boolean).join("   ·   ");

  if (onlyBeneficiaries) {
    // Mode allégé — uniquement le titre du programme (déjà dessiné
    // ci-dessus) + sa méta + la liste, aucune autre section.
    if (infoLine) cursor.paragraph(infoLine, { size: 9.5, color: COLORS.gray });
    cursor.spacer(6);
    cursor.divider();
    drawBeneficiariesSection(cursor, { applications, applicationsTotal });
  } else {
    if (program.description) {
      cursor.paragraph(program.description, { size: 10, color: COLORS.textSec });
      cursor.spacer(2);
    }
    if (infoLine) cursor.paragraph(infoLine, { size: 9.5, color: COLORS.gray });
    cursor.spacer(6);
    if (partner?.name) cursor.paragraph(`Rapport généré pour : ${partner.name}`, { size: 9, color: COLORS.gray, italic: true });
    cursor.spacer(10);

    cursor.sectionTitle("Chiffres clés");
    cursor.statGrid([
      { label: "Volontaires acceptés", value: stats.totalVolunteers },
      { label: `Mission validée (${stats.percentValidated}%)`, value: stats.validatedVolunteers },
      { label: "Progression moyenne", value: `${stats.averageProgress}%` },
      { label: "Tâches approuvées", value: stats.totalApprovedTasks },
    ]);

    cursor.sectionTitle("Progression dans le temps");
    cursor.barChart(progressOverTime);
    cursor.spacer(4);

    if (includeBeneficiaries) {
      drawBeneficiariesSection(cursor, { applications, applicationsTotal });
    }

    cursor.sectionTitle(`Volontaires à mission validée (${validatedVolunteers.length})`);
    const gallery = [];
    if (validatedVolunteers.length === 0) {
      cursor.paragraph("Aucun volontaire n'a encore validé sa mission sur ce programme.", { size: 9.5, color: COLORS.gray, italic: true });
    } else {
      validatedVolunteers.forEach((v) => {
        cursor.ensureSpace(24);
        cursor.page.drawText(toWinAnsiSafe(`${v.prenom} ${v.nom}`), { x: MARGIN, y: cursor.y, size: 11, font: fontBold, color: COLORS.primary });
        cursor.page.drawText(`${v.approvedTasks.length} tâche(s) approuvée(s)`, {
          x: MARGIN + fontBold.widthOfTextAtSize(toWinAnsiSafe(`${v.prenom} ${v.nom}`), 11) + 10,
          y: cursor.y, size: 8.5, font, color: COLORS.gray,
        });
        cursor.y -= 16;

        v.approvedTasks.forEach((t) => {
          cursor.ensureSpace(15);
          const dateLabel = t.occurrenceDate ? ` (${new Date(t.occurrenceDate).toLocaleDateString("fr-FR")})` : "";
          cursor.page.drawText(toWinAnsiSafe(`▸ ${t.taskTitle}${dateLabel}`), { x: MARGIN + 8, y: cursor.y, size: 9.5, font: fontBold, color: COLORS.text });
          cursor.y -= 14;

          (t.proofFields || []).forEach((f) => {
            const value = t.responses?.[f.id];
            if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
            if (f.type === "IMAGE") {
              const urls = Array.isArray(value) ? value : [];
              urls.forEach((url) => gallery.push({ url, caption: `${v.prenom} ${v.nom} — ${t.taskTitle}` }));
              cursor.bullet(`${f.label} : ${urls.length} photo(s) — voir l'aperçu en images ci-dessous`, { size: 9, indent: 16 });
              return;
            }
            const displayValue = f.type === "CHECKBOX" ? (value ? "Oui" : "Non") : String(value);
            cursor.bullet(`${f.label} : ${displayValue}`, { size: 9, indent: 16 });
          });
        });
        cursor.spacer(6);
      });
    }

    cursor.sectionTitle(`Aperçu en images (${gallery.length})`);
    if (gallery.length === 0) {
      cursor.paragraph("Aucune photo pour l'instant.", { size: 9.5, color: COLORS.gray, italic: true });
    } else {
      const shown = gallery.slice(0, 9);
      await cursor.imageGrid(shown);
      if (gallery.length > shown.length) {
        cursor.paragraph(
          `+ ${gallery.length - shown.length} autre(s) photo(s), visible(s) dans l'espace partenaire.`,
          { size: 8.5, color: COLORS.gray, italic: true }
        );
        cursor.spacer(6);
      }
    }

    cursor.sectionTitle("Vos échanges avec l'équipe AMP BENIN");
    if (comments.length === 0) {
      cursor.paragraph("Aucun échange pour l'instant.", { size: 9.5, color: COLORS.gray, italic: true });
    } else {
      comments.forEach((c) => {
        cursor.ensureSpace(20);
        cursor.paragraph(new Date(c.createdAt).toLocaleDateString("fr-FR"), { size: 7.5, color: COLORS.gray });
        cursor.paragraph(c.text, { size: 9.5, color: COLORS.text });
        if (c.reply) {
          cursor.ensureSpace(16);
          const replyDate = c.repliedAt ? ` (${new Date(c.repliedAt).toLocaleDateString("fr-FR")})` : "";
          cursor.paragraph(`Réponse de l'équipe${replyDate} :`, { size: 8.5, color: COLORS.primary, font: fontBold });
          cursor.paragraph(c.reply, { size: 9.5, color: COLORS.textSec });
        } else {
          cursor.paragraph("En attente de réponse", { size: 8.5, color: COLORS.gray, italic: true });
        }
        cursor.spacer(8);
      });
    }
  }

  // ── Pied de page (texte : numéro + date, une fois le total connu) ──
  // La bande visuelle (règle + barre des partenaires) est déjà dessinée
  // par ReportCursor#addPage sur chaque page — il ne manque que le texte,
  // qui a besoin de connaître le nombre total de pages.
  const generatedLabel = `Genere depuis le tableau de bord partenaire AMP BENIN le ${new Date().toLocaleDateString("fr-FR")}`;
  const pages = pdfDoc.getPages();
  const footerTextY = MARGIN + 12;
  pages.forEach((page, i) => {
    page.drawText(generatedLabel, { x: MARGIN, y: footerTextY, size: 7.5, font, color: COLORS.gray });
    const pageLabel = `Page ${i + 1} / ${pages.length}`;
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, 7.5);
    page.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN - pageLabelWidth, y: footerTextY, size: 7.5, font, color: COLORS.gray });
  });

  return pdfDoc.save();
}

module.exports = { buildPartnerImpactReportPdf, toWinAnsiSafe };
