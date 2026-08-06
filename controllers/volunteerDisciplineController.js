/**
 * Contrôleur Discipline & sanctions des volontaires — AMP Bénin
 * Signalement ("ce volontaire a un comportement indélicat") par
 * ADMIN/EDITOR/SUPERVISEUR/PARTENAIRE, scopé au volontaire "affecté" à eux
 * (canReportVolunteer, ci-dessous — même esprit que canSuperviseVolunteer/
 * assertPartnerAccess déjà en place ailleurs, jamais un raccourci vers ces
 * fonctions de review/suivi elles-mêmes). Traitement (avertissement/
 * suspension/bannissement, ou classement sans suite) réservé aux ADMIN —
 * voir routes/volunteerDisciplineRoute.js pour le détail des rôles admis
 * par route.
 *
 * Un ADMIN peut aussi sanctionner directement, sans signalement préalable
 * (applySanction accepte reportId optionnel).
 */

const getVolunteerProgramModel = require("../models/volunteerProgram");
const getVolunteerApplicationModel = require("../models/volunteerApplication");
const getUserModel = require("../models/gestionamp/User");
const Volunteer = require("../models/volunteer");
const VolunteerReport = require("../models/volunteerReport");
const VolunteerSanction = require("../models/volunteerSanction");
const BlacklistedVolunteer = require("../models/blacklistedVolunteer");
const resend = require("../utils/resendMailer");
const { renderBrandedEmail, escapeHtml } = require("../utils/emailTemplates");
const { canReviewProgram } = require("./volunteerProgramController");
const { getSupervisorAssignment } = require("./volunteerTaskController");
const { assertPartnerAccess } = require("./volunteerProgramPartnerController");

const RESEND_FROM = "VOLONTAIRE AMP BENIN <candidatures@ampbenin.org>";
const AMP_BRAND = {
  brandLabel: "AMP BÉNIN — Volontariat",
  footerText: "AMP BÉNIN — Programme de volontariat · Ceci est un message automatique.",
};

/* -------------------- Interne : qui peut signaler quel volontaire -------------------- */
/* ADMIN/EDITOR/reviewer de candidature → toujours (canReviewProgram,
   inchangé). SUPERVISEUR → seulement les volontaires de son sous-ensemble
   affecté sur CE programme. PARTENAIRE → seulement s'il suit ce programme
   ET que le volontaire apparaît dans une de ses deux vues autorisées
   (candidature PENDING/ACCEPTED, ou volontaire à Mission validée). */
async function canReportVolunteer(program, volunteerId, user, { application } = {}) {
  if (canReviewProgram(program, user)) return true;

  if (user.role === "SUPERVISEUR") {
    const assignment = await getSupervisorAssignment(user, program._id);
    if (!assignment) return false;
    return assignment.volunteerIds.some((id) => String(id) === String(volunteerId));
  }

  if (user.role === "PARTENAIRE") {
    if (!(await assertPartnerAccess(user.id, program._id))) return false;
    if (application) return ["PENDING", "ACCEPTED"].includes(application.status);
    const volunteer = await Volunteer.findById(volunteerId);
    if (!volunteer) return false;
    const entry = volunteer.programs.find((p) => String(p.programId) === String(program._id));
    return entry?.statut === "Mission validée";
  }

  return false;
}

/* -------------------- Staff (ADMIN/EDITOR/SUPERVISEUR/PARTENAIRE) : signaler un volontaire -------------------- */
exports.submitReport = async (req, res, next) => {
  try {
    const { programId, applicationId, volunteerId: bodyVolunteerId, reason } = req.body;
    if (!programId || !reason?.trim()) {
      return res.status(400).json({ message: "Programme et motif requis" });
    }
    if (!applicationId && !bodyVolunteerId) {
      return res.status(400).json({ message: "Candidature ou volontaire requis" });
    }

    const Program = getVolunteerProgramModel();
    const program = await Program.findById(programId);
    if (!program) return res.status(404).json({ message: "Programme introuvable" });

    let volunteerId = bodyVolunteerId || null;
    let application = null;

    if (applicationId) {
      const Application = getVolunteerApplicationModel();
      application = await Application.findById(applicationId);
      if (!application || String(application.programId) !== String(programId)) {
        return res.status(404).json({ message: "Candidature introuvable pour ce programme" });
      }
      if (application.volunteerId) {
        volunteerId = application.volunteerId;
      } else {
        // Candidature encore en attente : pas encore de compte Volunteer —
        // trouve-ou-crée l'identité par email (même pattern que
        // finalizeAcceptance dans volunteerApplicationController.js), sans
        // l'affecter au programme (ce n'est pas une admission).
        let volunteer = await Volunteer.findOne({ email: application.applicantEmail });
        if (!volunteer) {
          volunteer = await Volunteer.create({
            nom: application.applicantLastName,
            prenom: application.applicantFirstName,
            email: application.applicantEmail,
            telephone: application.applicantPhone || "",
          });
        }
        volunteerId = volunteer._id;
      }
    }

    if (!(await canReportVolunteer(program, volunteerId, req.user, { application }))) {
      return res.status(403).json({ message: "Vous n'êtes pas autorisé à signaler ce volontaire" });
    }

    const report = await VolunteerReport.create({
      volunteerId,
      programId,
      reportedBy: req.user.id,
      reportedByRole: req.user.role,
      reason: reason.trim(),
    });

    res.status(201).json({ message: "Signalement enregistré", report });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : file des signalements -------------------- */
exports.listReports = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const reports = await VolunteerReport.find(query).sort({ createdAt: -1 })
      .populate("volunteerId", "nom prenom email telephone");

    const GestionAmpUser = getUserModel();
    const reporterIds = [...new Set(reports.map((r) => String(r.reportedBy)))];
    const reporters = reporterIds.length > 0 ? await GestionAmpUser.find({ _id: { $in: reporterIds } }).select("name email") : [];
    const reporterById = new Map(reporters.map((u) => [String(u._id), u]));

    const Program = getVolunteerProgramModel();
    const programIds = [...new Set(reports.map((r) => String(r.programId)))];
    const programs = programIds.length > 0 ? await Program.find({ _id: { $in: programIds } }).select("title") : [];
    const programById = new Map(programs.map((p) => [String(p._id), p]));

    const items = reports.map((r) => ({
      _id: r._id,
      volunteer: r.volunteerId,
      programTitle: programById.get(String(r.programId))?.title || "?",
      reportedByName: reporterById.get(String(r.reportedBy))?.name || "?",
      reportedByRole: r.reportedByRole,
      reason: r.reason,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt,
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : classer un signalement sans suite -------------------- */
exports.dismissReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const report = await VolunteerReport.findById(id);
    if (!report) return res.status(404).json({ message: "Signalement introuvable" });
    if (report.status === "REVIEWED") return res.status(409).json({ message: "Ce signalement a déjà été traité" });

    report.status = "REVIEWED";
    report.reviewedBy = req.user.id;
    report.reviewedAt = new Date();
    report.resolution = "DISMISSED";
    await report.save();

    res.json({ message: "Signalement classé sans suite" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : appliquer une sanction -------------------- */
/* Fonctionne aussi bien à partir d'un signalement (reportId fourni, marqué
   REVIEWED en conséquence) que directement sur un volontaire choisi
   librement (reportId absent) — décision confirmée avec l'utilisateur. */
exports.applySanction = async (req, res, next) => {
  try {
    const { volunteerId, type, reason, suspendedUntil, reportId } = req.body;
    if (!volunteerId || !type || !reason?.trim()) {
      return res.status(400).json({ message: "Volontaire, type et motif requis" });
    }
    if (!["WARNING", "SUSPENSION", "BAN"].includes(type)) {
      return res.status(400).json({ message: "Type de sanction invalide" });
    }
    if (type === "SUSPENSION" && !suspendedUntil) {
      return res.status(400).json({ message: "Date de fin de suspension requise" });
    }

    const volunteer = await Volunteer.findById(volunteerId);
    if (!volunteer) return res.status(404).json({ message: "Volontaire introuvable" });

    const sanction = await VolunteerSanction.create({
      volunteerId,
      type,
      reason: reason.trim(),
      reportId: reportId || null,
      appliedBy: req.user.id,
      suspendedUntil: type === "SUSPENSION" ? new Date(suspendedUntil) : null,
    });

    if (type === "SUSPENSION") {
      volunteer.isActive = false;
      await volunteer.save();
      await sendSuspensionEmail(volunteer, reason.trim(), sanction.suspendedUntil);
    } else if (type === "BAN") {
      await BlacklistedVolunteer.create({
        nom: volunteer.nom,
        prenom: volunteer.prenom,
        email: volunteer.email,
        telephone: volunteer.telephone || "",
        reason: reason.trim(),
        bannedBy: req.user.id,
        originalVolunteerId: volunteer._id,
        sanctionId: sanction._id,
      });
      await sendBanEmail(volunteer, reason.trim());
      // Supprimé APRÈS l'envoi de l'email d'exclusion (a besoin de
      // volunteer.email) — "le compte est archivé dans la base des
      // volontaires indélicats", jamais récupérable ensuite.
      await Volunteer.findByIdAndDelete(volunteerId);
    } else {
      await sendWarningEmail(volunteer, reason.trim());
    }

    if (reportId) {
      await VolunteerReport.findByIdAndUpdate(reportId, {
        status: "REVIEWED",
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        resolution: type,
        sanctionId: sanction._id,
      });
    }

    res.status(201).json({ message: "Sanction appliquée", sanction });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : lever une sanction -------------------- */
/* SUSPENSION → réactive le compte (isActive = true). BAN → supprime
   l'entrée de la liste noire (plus aucune trace, nouvelle inscription
   possible avec le même email) — mais l'ancien compte Volunteer, lui, ne
   revient jamais ("il ne peut plus retrouver son compte"). */
exports.liftSanction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { liftReason } = req.body;

    const sanction = await VolunteerSanction.findById(id);
    if (!sanction) return res.status(404).json({ message: "Sanction introuvable" });
    if (sanction.status === "LIFTED") return res.status(409).json({ message: "Cette sanction est déjà levée" });

    sanction.status = "LIFTED";
    sanction.liftedBy = req.user.id;
    sanction.liftedAt = new Date();
    sanction.liftReason = liftReason?.trim() || "";
    await sanction.save();

    if (sanction.type === "SUSPENSION") {
      await Volunteer.findByIdAndUpdate(sanction.volunteerId, { isActive: true });
    } else if (sanction.type === "BAN") {
      await BlacklistedVolunteer.deleteOne({ sanctionId: sanction._id });
    }

    res.json({ message: "Sanction levée" });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : historique des sanctions d'un volontaire -------------------- */
exports.listVolunteerSanctions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sanctions = await VolunteerSanction.find({ volunteerId: id }).sort({ appliedAt: -1 });
    res.json({ items: sanctions });
  } catch (error) {
    next(error);
  }
};

/* -------------------- ADMIN uniquement : sanctions actuellement actives -------------------- */
exports.listActiveSanctions = async (req, res, next) => {
  try {
    const sanctions = await VolunteerSanction.find({ status: "ACTIVE" }).sort({ appliedAt: -1 })
      .populate("volunteerId", "nom prenom email telephone");
    res.json({ items: sanctions });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Staff : liste noire complète (croisée côté client) -------------------- */
/* Volume attendu faible — chargée une fois par les écrans qui en ont
   besoin (listes de candidatures) et croisée côté client par email/
   téléphone/nom+prénom, plutôt que d'alourdir listApplications/
   listPartnerApplications avec ce croisement à chaque requête. */
exports.listBlacklist = async (req, res, next) => {
  try {
    const items = await BlacklistedVolunteer.find().sort({ bannedAt: -1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Emails -------------------- */

async function sendWarningEmail(volunteer, reason) {
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: volunteer.email,
      subject: "Avertissement — AMP BÉNIN Volontariat",
      text: [
        `Bonjour ${volunteer.prenom} ${volunteer.nom},`,
        ``,
        `Vous recevez un avertissement de la part de l'équipe AMP BÉNIN :`,
        reason,
        ``,
        `Merci de veiller au respect des règles du volontariat AMP BÉNIN.`,
      ].join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Avertissement",
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(volunteer.prenom)} ${escapeHtml(volunteer.nom)},</p>`,
          `<p>Vous recevez un avertissement de la part de l'équipe AMP BÉNIN :</p>`,
          `<p style="background:#FDF4E7;padding:12px 16px;border-radius:8px;">${escapeHtml(reason)}</p>`,
          `<p>Merci de veiller au respect des règles du volontariat AMP BÉNIN.</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email d'avertissement:", mailError.message);
  }
}

async function sendSuspensionEmail(volunteer, reason, suspendedUntil) {
  const dateStr = suspendedUntil ? new Date(suspendedUntil).toLocaleDateString("fr-FR") : null;
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: volunteer.email,
      subject: "Suspension de votre compte — AMP BÉNIN Volontariat",
      text: [
        `Bonjour ${volunteer.prenom} ${volunteer.nom},`,
        ``,
        `Votre compte volontaire AMP BÉNIN est suspendu${dateStr ? ` jusqu'au ${dateStr}` : ""}.`,
        `Motif : ${reason}`,
        ``,
        `Vous pourrez vous reconnecter normalement à l'issue de cette période.`,
      ].join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Compte suspendu",
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(volunteer.prenom)} ${escapeHtml(volunteer.nom)},</p>`,
          `<p>Votre compte volontaire AMP BÉNIN est suspendu${dateStr ? ` jusqu'au <strong>${dateStr}</strong>` : ""}.</p>`,
          `<p><strong>Motif :</strong> ${escapeHtml(reason)}</p>`,
          `<p>Vous pourrez vous reconnecter normalement à l'issue de cette période.</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email de suspension:", mailError.message);
  }
}

async function sendBanEmail(volunteer, reason) {
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: volunteer.email,
      subject: "Exclusion définitive — AMP BÉNIN Volontariat",
      text: [
        `Bonjour ${volunteer.prenom} ${volunteer.nom},`,
        ``,
        `Votre compte volontaire AMP BÉNIN a été définitivement exclu du programme.`,
        `Motif : ${reason}`,
      ].join("\n"),
      html: renderBrandedEmail({
        ...AMP_BRAND,
        title: "Exclusion définitive",
        bodyHtml: [
          `<p>Bonjour ${escapeHtml(volunteer.prenom)} ${escapeHtml(volunteer.nom)},</p>`,
          `<p>Votre compte volontaire AMP BÉNIN a été <strong>définitivement exclu</strong> du programme.</p>`,
          `<p><strong>Motif :</strong> ${escapeHtml(reason)}</p>`,
        ].join(""),
      }),
    });
  } catch (mailError) {
    console.error("❌ Erreur envoi email d'exclusion:", mailError.message);
  }
}
