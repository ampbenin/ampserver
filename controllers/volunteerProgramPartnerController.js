/**
 * Contrôleur "Compte partenaire" — Programmes de volontariat AMP Bénin
 * Lecture seule des statistiques/impact/résultats d'un ou plusieurs
 * programmes suivis (GestionAmpUser.partnerProgramIds), jamais les tâches
 * rejetées/en attente — uniquement les volontaires à "Mission validée" et
 * leurs tâches APPROUVÉES. Les partenaires peuvent aussi poster un
 * commentaire, visible seulement par ADMIN/EDITOR (voir listPartnerComments).
 */

const mongoose = require("mongoose");
const streamifier = require("streamifier");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerTaskSubmissionModel = require("../models/volunteerTaskSubmission");
const getVolunteerProgramPartnerCommentModel = require("../models/volunteerProgramPartnerComment");
const getUserModel = require("../models/gestionamp/User");
const Volunteer = require("../models/volunteer");
const cloudinary = require("../utils/cloudinary");
const { computeProgress } = require("../utils/volunteerTaskLogic");
const { getEffectiveProofFields } = require("./volunteerTaskController");

/* -------------------- Interne : vérifie que ce partenaire suit bien ce programme -------------------- */
async function assertPartnerAccess(userId, programId) {
  const User = getUserModel();
  const partner = await User.findById(userId).select("partnerProgramIds");
  return (partner?.partnerProgramIds || []).some((id) => id.toString() === programId.toString());
}

/* -------------------- Protégé (PARTENAIRE) : programmes suivis -------------------- */
exports.listMyPartnerPrograms = async (req, res, next) => {
  try {
    const User = getUserModel();
    const partner = await User.findById(req.user.id).select("partnerProgramIds");
    const Program = getVolunteerProgramModel();
    const programs = await Program.find({ _id: { $in: partner?.partnerProgramIds || [] } })
      .select("title location startDate endDate status");
    res.json({ items: programs });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : statistiques/impact/résultats d'un programme -------------------- */
exports.getPartnerProgramStats = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId)
      .select("title description location startDate endDate tasks missionValidationThreshold");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const volunteers = await Volunteer.find({ "programs.programId": programId }).select("nom prenom programs");
    const Submission = getVolunteerTaskSubmissionModel();
    const allSubmissions = await Submission.find({ programId }).lean();

    // Progression dans le temps (graphique du dashboard partenaire) : nombre
    // de tâches approuvées par mois, groupé sur reviewedAt (date de validation
    // par le staff/superviseur) — reflète le rythme réel d'activité plutôt que
    // la date d'échéance de la tâche.
    const progressOverTimeRaw = await Submission.aggregate([
      { $match: { programId: new mongoose.Types.ObjectId(programId), status: "APPROVED", reviewedAt: { $ne: null } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$reviewedAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const progressOverTime = progressOverTimeRaw.map((r) => ({ label: r._id, count: r.count }));

    const submissionsByVolunteer = new Map();
    allSubmissions.forEach((s) => {
      const key = String(s.volunteerId);
      if (!submissionsByVolunteer.has(key)) submissionsByVolunteer.set(key, []);
      submissionsByVolunteer.get(key).push(s);
    });
    const taskById = new Map((program.tasks || []).map((t) => [t.id, t]));

    let percentSum = 0;
    let totalApproved = 0;
    let validatedCount = 0;
    const validatedVolunteers = [];

    for (const v of volunteers) {
      const programEntry = v.programs.find((p) => p.programId.toString() === programId);
      const submissions = submissionsByVolunteer.get(String(v._id)) || [];
      const progress = computeProgress(program.tasks || [], programEntry.assignedAt, program.endDate, submissions);
      percentSum += progress.percent;
      totalApproved += submissions.filter((s) => s.status === "APPROVED").length;

      if (programEntry.statut === "Mission validée") {
        validatedCount += 1;
        const approvedTasks = submissions
          .filter((s) => s.status === "APPROVED")
          .map((s) => {
            const task = taskById.get(s.taskId);
            return {
              taskTitle: task?.title || "Tâche",
              occurrenceDate: s.occurrenceDate,
              responses: s.responses,
              proofFields: task ? getEffectiveProofFields(task) : [],
            };
          });
        validatedVolunteers.push({ volunteerId: v._id, nom: v.nom, prenom: v.prenom, approvedTasks });
      }
    }

    res.json({
      program: {
        title: program.title, description: program.description, location: program.location,
        startDate: program.startDate, endDate: program.endDate,
      },
      stats: {
        totalVolunteers: volunteers.length,
        validatedVolunteers: validatedCount,
        percentValidated: volunteers.length > 0 ? Math.round((validatedCount / volunteers.length) * 100) : 0,
        averageProgress: volunteers.length > 0 ? Math.round(percentSum / volunteers.length) : 0,
        totalApprovedTasks: totalApproved,
      },
      validatedVolunteers,
      progressOverTime,
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : upload de son logo (co-branding du dashboard) -------------------- */
exports.uploadPartnerLogo = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

    const uploaded = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "ong-site/partner-logos", resource_type: "image" },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    const User = getUserModel();
    await User.findByIdAndUpdate(req.user.id, { partnerLogoUrl: uploaded.secure_url });

    res.status(201).json({ url: uploaded.secure_url });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : poster un commentaire/suggestion -------------------- */
exports.submitPartnerComment = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ message: "Le commentaire ne peut pas être vide" });
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Comment = getVolunteerProgramPartnerCommentModel();
    await Comment.create({ programId, partnerId: req.user.id, text: text.trim() });
    res.status(201).json({ message: "Commentaire envoyé" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : historique de mes propres commentaires (+ réponses de l'équipe) -------------------- */
exports.listMyComments = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Comment = getVolunteerProgramPartnerCommentModel();
    const comments = await Comment.find({ programId, partnerId: req.user.id }).sort({ createdAt: -1 });

    const items = comments.map((c) => ({
      _id: c._id,
      text: c.text,
      createdAt: c.createdAt,
      reply: c.reply,
      repliedAt: c.repliedAt,
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR uniquement) : journal des commentaires partenaires -------------------- */
exports.listPartnerComments = async (req, res, next) => {
  try {
    const { programId } = req.params;
    const Comment = getVolunteerProgramPartnerCommentModel();
    const comments = await Comment.find({ programId }).sort({ createdAt: -1 });

    const User = getUserModel();
    const partnerIds = [...new Set(comments.map((c) => String(c.partnerId)))];
    const partners = partnerIds.length > 0 ? await User.find({ _id: { $in: partnerIds } }).select("name email") : [];
    const partnerById = new Map(partners.map((p) => [String(p._id), p]));

    const items = comments.map((c) => ({
      _id: c._id,
      text: c.text,
      createdAt: c.createdAt,
      partnerName: partnerById.get(String(c.partnerId))?.name || "Partenaire",
      partnerEmail: partnerById.get(String(c.partnerId))?.email || "",
      reply: c.reply,
      repliedAt: c.repliedAt,
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff (ADMIN/EDITOR uniquement) : répondre à un commentaire partenaire -------------------- */
exports.replyToComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const reply = req.body?.reply?.trim() || "";
    if (!reply) {
      return res.status(400).json({ message: "La réponse ne peut pas être vide" });
    }

    const Comment = getVolunteerProgramPartnerCommentModel();
    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Commentaire introuvable" });

    comment.reply = reply;
    comment.repliedAt = new Date();
    comment.repliedBy = req.user.id;
    await comment.save();

    res.json({ message: "Réponse envoyée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Protégé (PARTENAIRE) : rapport d'impact PDF, généré à la demande -------------------- */
exports.downloadImpactReport = async (req, res, next) => {
  try {
    const { programId } = req.params;
    if (!(await assertPartnerAccess(req.user.id, programId))) {
      return res.status(403).json({ message: "Vous ne suivez pas ce programme" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId).select("title description location startDate endDate");
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    const volunteers = await Volunteer.find({ "programs.programId": programId }).select("nom prenom programs");
    const Submission = getVolunteerTaskSubmissionModel();
    const allSubmissions = await Submission.find({ programId }).lean();
    const approvedCountByVolunteer = new Map();
    allSubmissions.forEach((s) => {
      if (s.status !== "APPROVED") return;
      const key = String(s.volunteerId);
      approvedCountByVolunteer.set(key, (approvedCountByVolunteer.get(key) || 0) + 1);
    });

    const validatedVolunteers = volunteers.filter((v) => {
      const entry = v.programs.find((p) => p.programId.toString() === programId);
      return entry?.statut === "Mission validée";
    });

    const User = getUserModel();
    const partner = await User.findById(req.user.id).select("name partnerLogoUrl");

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait, en points
    const margin = 50;
    let y = 841.89 - margin;
    const primary = rgb(0x1b / 255, 0x43 / 255, 0x32 / 255); // vert de marque AMP BENIN
    const gray = rgb(0.35, 0.35, 0.35);

    // Logo du partenaire, si défini — n'empêche jamais la génération du PDF
    // en cas d'échec (réseau, format non supporté par pdf-lib, etc.).
    if (partner?.partnerLogoUrl) {
      try {
        const imgResponse = await fetch(partner.partnerLogoUrl);
        const imgBytes = new Uint8Array(await imgResponse.arrayBuffer());
        const contentType = imgResponse.headers.get("content-type") || "";
        const image = contentType.includes("png")
          ? await pdfDoc.embedPng(imgBytes)
          : await pdfDoc.embedJpg(imgBytes);
        const logoHeight = 40;
        const logoWidth = (image.width / image.height) * logoHeight;
        page.drawImage(image, { x: 595.28 - margin - logoWidth, y: y - logoHeight + 10, width: logoWidth, height: logoHeight });
      } catch (logoError) {
        console.error("⚠️ Logo partenaire non intégré au PDF :", logoError.message);
      }
    }

    page.drawText("AMP BENIN — Rapport d'impact", { x: margin, y, size: 12, font, color: gray });
    y -= 30;
    page.drawText(toWinAnsiSafe(program.title), { x: margin, y, size: 20, font: fontBold, color: primary });
    y -= 22;
    if (program.description) {
      page.drawText(toWinAnsiSafe(truncateForPdf(program.description, 100)), { x: margin, y, size: 10, font, color: gray });
      y -= 16;
    }
    const infoLine = [
      program.location ? `Lieu : ${program.location}` : null,
      program.startDate ? `Début : ${new Date(program.startDate).toLocaleDateString("fr-FR")}` : null,
      program.endDate ? `Fin : ${new Date(program.endDate).toLocaleDateString("fr-FR")}` : null,
    ].filter(Boolean).join("   ·   ");
    if (infoLine) {
      page.drawText(toWinAnsiSafe(infoLine), { x: margin, y, size: 10, font, color: gray });
      y -= 30;
    } else {
      y -= 14;
    }

    page.drawText("Chiffres clés", { x: margin, y, size: 13, font: fontBold, color: primary });
    y -= 20;
    const percentValidated = volunteers.length > 0 ? Math.round((validatedVolunteers.length / volunteers.length) * 100) : 0;
    const totalApproved = [...approvedCountByVolunteer.values()].reduce((sum, n) => sum + n, 0);
    const statLines = [
      `Volontaires acceptés : ${volunteers.length}`,
      `Mission validée : ${validatedVolunteers.length} (${percentValidated} %)`,
      `Tâches approuvées au total : ${totalApproved}`,
    ];
    statLines.forEach((line) => {
      page.drawText(`•  ${line}`, { x: margin + 10, y, size: 11, font });
      y -= 16;
    });
    y -= 14;

    page.drawText(`Volontaires à mission validée (${validatedVolunteers.length})`, { x: margin, y, size: 13, font: fontBold, color: primary });
    y -= 20;
    if (validatedVolunteers.length === 0) {
      page.drawText("Aucun volontaire n'a encore validé sa mission sur ce programme.", { x: margin + 10, y, size: 10, font, color: gray });
      y -= 16;
    } else {
      validatedVolunteers.forEach((v) => {
        if (y < margin + 30) return; // évite de déborder d'une simple page A4 (v1)
        const count = approvedCountByVolunteer.get(String(v._id)) || 0;
        page.drawText(toWinAnsiSafe(`•  ${v.prenom} ${v.nom} — ${count} tâche(s) approuvée(s)`), { x: margin + 10, y, size: 10, font });
        y -= 15;
      });
    }

    page.drawText(
      `Généré depuis le tableau de bord partenaire AMP BENIN le ${new Date().toLocaleDateString("fr-FR")}`,
      { x: margin, y: margin - 15, size: 8, font, color: gray }
    );

    const pdfBytes = await pdfDoc.save();
    const slug = program.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-impact-${slug || "programme"}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    next(error);
  }
};

function truncateForPdf(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

// StandardFonts (WinAnsi/Windows-1252) ne couvre que le Latin-1 étendu —
// un emoji ou tout caractère hors de cette plage fait planter drawText()
// (constaté en pratique avec 📍 pendant les tests). Filtre défensif pour
// tout texte pouvant venir de la base (titre de programme, nom de
// volontaire...) plutôt que de ne sécuriser que les chaînes en dur.
function toWinAnsiSafe(text) {
  return [...String(text)].filter((ch) => ch.codePointAt(0) <= 0xff).join("");
}
