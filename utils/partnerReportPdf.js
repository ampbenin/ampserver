/**
 * Génération du PDF "Rapport d'impact" téléchargeable depuis le tableau de
 * bord PARTENAIRE (voir controllers/volunteerProgramPartnerController.js
 * #downloadImpactReport). Construit un document A4 multi-page avec pdf-lib
 * (pas de dépendance supplémentaire), reprenant TOUTES les sections déjà
 * visibles par le partenaire sur son tableau de bord — chiffres clés,
 * progression dans le temps (mini bar chart dessiné à la main), candidatures
 * reçues (jamais les rejetées), volontaires à mission validée et le détail
 * de leurs tâches approuvées, aperçu en images, et ses échanges avec
 * l'équipe — pour que le PDF soit un vrai reflet fidèle de ce à quoi il a
 * accès, pas un simple résumé de 3 chiffres.
 *
 * Refonte du 2026-08-07 : le PDF v1 ne contenait que le titre du programme
 * et une liste des volontaires validés (rien d'autre) — l'utilisateur a
 * demandé que le PDF contienne "les informations et détails dont [les
 * partenaires] ont accès" avec une bonne mise en forme. Ce fichier
 * remplace la génération procédurale ad-hoc de l'ancien contrôleur par un
 * petit "curseur" de mise en page (ReportCursor) qui gère la pagination
 * automatique (nouvelle page + en-tête de continuation + répétition de
 * l'en-tête de tableau), le retour à la ligne du texte, un mini bar chart,
 * une grille d'images et des tableaux zébrés — le tout avec la charte
 * graphique de la marque (vert forêt / or ambré, cf. src/styles/tokens.css
 * côté frontend, dont les teintes sont reprises ici en dur car pdf-lib ne
 * lit pas de CSS).
 */

const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

const PAGE_WIDTH = 595.28; // A4 portrait, en points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

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

// Curseur de mise en page : gère la position Y courante, le changement de
// page automatique (avec en-tête de continuation + répétition d'en-tête de
// tableau), et une poignée d'éléments réutilisables (titres de section,
// paragraphes, listes à puces, grille de statistiques, mini bar chart,
// tableau zébré, grille d'images).
class ReportCursor {
  constructor(pdfDoc, font, fontBold, fontItalic, programTitle) {
    this.pdfDoc = pdfDoc;
    this.font = font;
    this.fontBold = fontBold;
    this.fontItalic = fontItalic;
    this.programTitle = programTitle;
    this.page = null;
    this.y = 0;
    this.pageCount = 0;
    this.addPage(true);
  }

  addPage(isFirst = false) {
    this.page = this.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pageCount += 1;
    this.y = PAGE_HEIGHT - MARGIN;
    if (!isFirst) {
      this.page.drawText(toWinAnsiSafe(`AMP BENIN · ${this.programTitle} (suite)`), {
        x: MARGIN, y: this.y, size: 8.5, font: this.font, color: COLORS.gray,
      });
      this.page.drawLine({ start: { x: MARGIN, y: this.y - 6 }, end: { x: PAGE_WIDTH - MARGIN, y: this.y - 6 }, thickness: 0.75, color: COLORS.border });
      this.y -= 28;
    }
  }

  ensureSpace(height) {
    if (this.y - height < MARGIN + 24) this.addPage(false);
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
      if (this.y - rowHeight < MARGIN + 24) {
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
        try {
          const imgResponse = await fetch(photo.url);
          const imgBytes = new Uint8Array(await imgResponse.arrayBuffer());
          const contentType = imgResponse.headers.get("content-type") || "";
          const image = contentType.includes("png") ? await this.pdfDoc.embedPng(imgBytes) : await this.pdfDoc.embedJpg(imgBytes);
          const scale = Math.min(cellSize / image.width, cellSize / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          this.page.drawImage(image, { x: x + (cellSize - w) / 2, y: rowTop - cellSize + (cellSize - h) / 2, width: w, height: h });
        } catch (imgError) {
          console.error("⚠️ Photo de galerie non intégrée au rapport PDF :", imgError.message);
        }
        const caption = truncateToWidth(photo.caption, this.font, 6.5, cellSize);
        this.page.drawText(caption, { x, y: rowTop - cellSize - 11, size: 6.5, font: this.font, color: COLORS.gray });
      }
      this.y = rowTop - cellSize - 22;
    }
  }
}

/**
 * Construit le PDF complet et renvoie ses bytes.
 *
 * @param {object} data
 * @param {object} data.program        {title, description, location, startDate, endDate}
 * @param {object} data.partner        {name, partnerLogoUrl}
 * @param {object} data.stats          {totalVolunteers, validatedVolunteers, percentValidated, averageProgress, totalApprovedTasks}
 * @param {Array}  data.validatedVolunteers  [{nom, prenom, approvedTasks: [{taskTitle, occurrenceDate, responses, proofFields}]}]
 * @param {Array}  data.progressOverTime     [{label, count}]
 * @param {Array}  data.applications   [{applicantFirstName, applicantLastName, applicantEmail, applicantPhone, status, createdAt}]
 * @param {number} data.applicationsTotal    total réel (peut dépasser applications.length si tronqué)
 * @param {Array}  data.comments       [{text, createdAt, reply, repliedAt}]
 */
async function buildPartnerImpactReportPdf(data) {
  const { program, partner, stats, validatedVolunteers, progressOverTime, applications, applicationsTotal, comments } = data;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const cursor = new ReportCursor(pdfDoc, font, fontBold, fontItalic, program.title);

  // ── En-tête de marque + logo partenaire ──────────────────────────────
  cursor.page.drawText("AMP BENIN", { x: MARGIN, y: cursor.y, size: 11, font: fontBold, color: COLORS.primary });
  cursor.page.drawText("Rapport d'impact partenaire", { x: MARGIN + 68, y: cursor.y, size: 11, font, color: COLORS.gray });

  if (partner?.partnerLogoUrl) {
    try {
      const imgResponse = await fetch(partner.partnerLogoUrl);
      const imgBytes = new Uint8Array(await imgResponse.arrayBuffer());
      const contentType = imgResponse.headers.get("content-type") || "";
      const image = contentType.includes("png") ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
      const logoHeight = 36;
      const logoWidth = (image.width / image.height) * logoHeight;
      cursor.page.drawImage(image, { x: PAGE_WIDTH - MARGIN - logoWidth, y: cursor.y - logoHeight + 9, width: logoWidth, height: logoHeight });
    } catch (logoError) {
      console.error("⚠️ Logo partenaire non intégré au PDF :", logoError.message);
    }
  }
  cursor.y -= 32;
  cursor.divider();

  // ── Titre + description + méta du programme ─────────────────────────
  cursor.page.drawText(toWinAnsiSafe(program.title), { x: MARGIN, y: cursor.y, size: 20, font: fontBold, color: COLORS.primary });
  cursor.y -= 26;
  if (program.description) {
    cursor.paragraph(program.description, { size: 10, color: COLORS.textSec });
    cursor.spacer(2);
  }
  const infoLine = [
    program.location ? `Lieu : ${program.location}` : null,
    program.startDate ? `Début : ${new Date(program.startDate).toLocaleDateString("fr-FR")}` : null,
    program.endDate ? `Fin : ${new Date(program.endDate).toLocaleDateString("fr-FR")}` : null,
  ].filter(Boolean).join("   ·   ");
  if (infoLine) {
    cursor.paragraph(infoLine, { size: 9.5, color: COLORS.gray });
  }
  cursor.spacer(6);

  if (partner?.name) {
    cursor.paragraph(`Rapport généré pour : ${partner.name}`, { size: 9, color: COLORS.gray, italic: true });
  }
  cursor.spacer(10);

  // ── Chiffres clés ─────────────────────────────────────────────────
  cursor.sectionTitle("Chiffres clés");
  cursor.statGrid([
    { label: "Volontaires acceptés", value: stats.totalVolunteers },
    { label: `Mission validée (${stats.percentValidated}%)`, value: stats.validatedVolunteers },
    { label: "Progression moyenne", value: `${stats.averageProgress}%` },
    { label: "Tâches approuvées", value: stats.totalApprovedTasks },
  ]);

  // ── Progression dans le temps ────────────────────────────────────
  cursor.sectionTitle("Progression dans le temps");
  cursor.barChart(progressOverTime);
  cursor.spacer(4);

  // ── Candidatures reçues (jamais les rejetées) ────────────────────
  cursor.sectionTitle(`Candidatures reçues (${applicationsTotal})`);
  if (applications.length === 0) {
    cursor.paragraph("Aucune candidature reçue pour l'instant sur ce programme.", { size: 9.5, color: COLORS.gray, italic: true });
  } else {
    cursor.table(
      [
        { label: "CANDIDAT", width: 130, key: "candidat" },
        { label: "EMAIL", width: 155, key: "email" },
        { label: "TÉLÉPHONE", width: 80, key: "telephone" },
        { label: "STATUT", width: 65, key: "statutLabel", color: (row) => (row.status === "ACCEPTED" ? COLORS.success : COLORS.accent) },
        { label: "DATE", width: 65.28, key: "date" },
      ],
      applications.map((a) => ({
        candidat: `${a.applicantFirstName || ""} ${a.applicantLastName || ""}`.trim(),
        email: a.applicantEmail,
        telephone: a.applicantPhone,
        status: a.status,
        statutLabel: a.status === "ACCEPTED" ? "Acceptée" : "En attente",
        date: a.createdAt ? new Date(a.createdAt).toLocaleDateString("fr-FR") : "",
      }))
    );
    if (applicationsTotal > applications.length) {
      cursor.paragraph(
        `+ ${applicationsTotal - applications.length} autre(s) candidature(s), consultable(s) dans l'espace partenaire.`,
        { size: 8.5, color: COLORS.gray, italic: true }
      );
      cursor.spacer(6);
    }
  }

  // ── Volontaires à mission validée (détail des tâches) ────────────
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

  // ── Aperçu en images ──────────────────────────────────────────────
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

  // ── Échanges avec l'équipe ────────────────────────────────────────
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

  // ── Pied de page (numéro sur toutes les pages, une fois le total connu) ──
  const generatedLabel = `Genere depuis le tableau de bord partenaire AMP BENIN le ${new Date().toLocaleDateString("fr-FR")}`;
  const pages = pdfDoc.getPages();
  pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN - 6 }, end: { x: PAGE_WIDTH - MARGIN, y: MARGIN - 6 }, thickness: 0.5, color: COLORS.border });
    page.drawText(generatedLabel, { x: MARGIN, y: MARGIN - 18, size: 7.5, font, color: COLORS.gray });
    const pageLabel = `Page ${i + 1} / ${pages.length}`;
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, 7.5);
    page.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN - pageLabelWidth, y: MARGIN - 18, size: 7.5, font, color: COLORS.gray });
  });

  return pdfDoc.save();
}

module.exports = { buildPartnerImpactReportPdf, toWinAnsiSafe };
