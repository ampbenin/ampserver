// controllers/admin/newsletterController.js
const resend = require('../../utils/resendMailer');
const getNewsletterModel = require('../../models/Newsletter');

/**
 * GET /admin/newsletters
 */
exports.getAll = async (req, res) => {
  try {
    const Newsletter = getNewsletterModel();
    const { page = 1, limit = 25 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Newsletter.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Newsletter.countDocuments(),
    ]);

    return res.json({ items, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("❌ ERREUR GET NEWSLETTER :", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

/**
 * POST /admin/newsletters/send
 */
exports.sendMail = async (req, res) => {
  try {
    const Newsletter = getNewsletterModel();
    const { type, email, from, to, emails, subject, text, html } = req.body;
    let recipients = [];

    if (type === 'all') {
      const subs = await Newsletter.find().select('email -_id');
      recipients = subs.map((s) => s.email);
    } else if (type === 'single' && email) {
      recipients = [email];
    } else if (type === 'list' && Array.isArray(emails)) {
      recipients = emails.filter(Boolean);
    } else if (type === 'range') {
      const subs = await Newsletter.find().sort({ createdAt: -1 });
      const f = Math.max(0, parseInt(from) || 0);
      const t = Math.min(subs.length - 1, parseInt(to) || subs.length - 1);
      recipients = subs.slice(f, t + 1).map((s) => s.email);
    } else {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }

    if (!recipients.length) {
      return res.status(400).json({ error: 'Aucun destinataire' });
    }

    // Envoi batch — 50 destinataires max par appel (limite Resend), contre
    // 80 auparavant avec le SMTP historique.
    const batchSize = 50;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      await resend.emails.send({
        // Fixé en dur : process.env.RESEND_FROM_EMAIL est partagée avec NumSAL
        // et réglée côté serveur sur son nom de marque, ce qui affichait
        // "NumSAL" comme expéditeur de la newsletter AMP Bénin.
        from: 'AMP BENIN <onboarding@resend.dev>',
        to: batch,
        subject: subject || 'Newsletter',
        text: text || '',
        html: html || undefined,
      });
      console.log(`Batch envoyé : ${batch.length}`);
    }

    res.json({ ok: true, sentTo: recipients.length });
  } catch (err) {
    console.error('Erreur sendMail:', err);
    res.status(500).json({ error: 'Erreur envoi email' });
  }
};

/**
 * DELETE /admin/newsletters/:id
 */
exports.remove = async (req, res) => {
  try {
    const Newsletter = getNewsletterModel();
    const deleted = await Newsletter.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Abonné non trouvé' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur suppression Newsletter:', err);
    res.status(500).json({ error: 'Erreur suppression' });
  }
};
