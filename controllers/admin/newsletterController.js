// controllers/admin/newsletterController.js
const nodemailer = require('nodemailer');
const getNewsletterModel = require('../../models/Newsletter'); 

// ⚙️ Configuration transporteur nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * GET /admin/newsletters
 */
exports.getAll = async (req, res) => {
  try {
    const Newsletter = getNewsletterModel(); // ⚡ récupère le modèle après init formDB
    console.log("🔥 getAll newsletters appelé");
    const list = await Newsletter.find().sort({ createdAt: -1 });
    return res.json(list);
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

    // Envoi batch
    const batchSize = 80;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: batch.join(','),
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
