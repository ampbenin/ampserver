const resend = require("./resendMailer");
const { renderBrandedEmail, escapeHtml } = require("./emailTemplates");

const FROM = "AMP BÉNIN <candidatures@ampbenin.org>";
const BCC_BATCH_SIZE = 50;

// Envoi groupé : les destinataires sont en copie cachée (CCI), jamais visibles
// les uns des autres. Découpé en lots pour rester sous les limites d'un envoi.
const sendBulkEmail = async (recipients, subject, message) => {
  const unique = [...new Set(recipients.map((e) => e.trim().toLowerCase()))];
  const html = renderBrandedEmail({
    title: subject,
    bodyHtml: `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
    brandLabel: "AMP BÉNIN — Campagne",
    footerText: "AMP BÉNIN · Vous recevez ce message car vous êtes lié à une campagne AMP BÉNIN.",
  });

  let sent = 0;
  for (let i = 0; i < unique.length; i += BCC_BATCH_SIZE) {
    const bcc = unique.slice(i, i + BCC_BATCH_SIZE);
    await resend.emails.send({ from: FROM, to: FROM, bcc, subject, html });
    sent += bcc.length;
  }
  return sent;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { sendBulkEmail, escapeRegex };
