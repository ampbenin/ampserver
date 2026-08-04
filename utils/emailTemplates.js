/**
 * Gabarit HTML partagé pour les emails automatiques liés à un programme
 * (réception de candidature, admission) — mise en page inline-CSS (pas de
 * <style> externe : nécessaire pour un rendu correct dans la majorité des
 * clients mail, y compris Outlook desktop). `renderBrandedEmail` est le
 * shell générique (paramétré par les couleurs/le nom de marque) réutilisé
 * par tous les systèmes "programme + candidature" de ce backend ; chaque
 * système garde son propre wrapper avec sa charte (NumSAL : voir
 * `renderNumsalEmail` ci-dessous, encore aux couleurs vert/or historiques
 * de NumSAL — la charte violet/bleu du site NumSAL actuel n'a pas été
 * répercutée ici, hors scope de ce chantier).
 */

const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// wa.me exige un numéro en chiffres uniquement (indicatif pays inclus, sans
// "+" ni espaces) — on nettoie ce que l'utilisateur a pu saisir.
const toWhatsappDigits = (phone) => String(phone || "").replace(/[^\d]/g, "");

const renderContactBlockHtml = ({ contactWhatsapp, contactEmail, accentColor = "#C9903A" } = {}) => {
  const whatsapp = toWhatsappDigits(contactWhatsapp);
  const email = contactEmail;
  if (!whatsapp && !email) return "";

  const buttons = [
    whatsapp &&
      `<a href="https://wa.me/${whatsapp}" style="display:inline-block;background:#1B4332;color:#FFFFFF;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:14px;margin:0 6px 8px;">💬 WhatsApp</a>`,
    email &&
      `<a href="mailto:${escapeHtml(email)}" style="display:inline-block;background:${accentColor};color:#111111;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:14px;margin:0 6px 8px;">✉️ ${escapeHtml(email)}</a>`,
  ]
    .filter(Boolean)
    .join("");

  return `
    <div style="padding:0 32px 32px;text-align:center;">
      <p style="font-size:13px;color:#7A7A7A;margin:0 0 12px;">Une question, une préoccupation ? Contactez-nous :</p>
      <div>${buttons}</div>
    </div>`;
};

const renderContactBlockText = ({ contactWhatsapp, contactEmail } = {}) => {
  const lines = [];
  if (contactWhatsapp) lines.push(`WhatsApp : ${contactWhatsapp}`);
  if (contactEmail) lines.push(`Email : ${contactEmail}`);
  if (lines.length === 0) return "";
  return `\nUne question, une préoccupation ? Contactez-nous :\n${lines.join("\n")}\n`;
};

/**
 * Shell d'email générique, réutilisable par n'importe quel système
 * "programme + candidature" de ce backend.
 * @param {object} params
 * @param {string} params.title          Titre affiché dans le bandeau (ex: nom du programme)
 * @param {string} params.bodyHtml       Corps du message, déjà en HTML (paragraphes, etc.)
 * @param {string} [params.contactWhatsapp]
 * @param {string} [params.contactEmail]
 * @param {string} params.brandLabel     Petit label en majuscules dans le bandeau (ex: "NumSAL", "AMP BÉNIN — Volontariat")
 * @param {string} params.footerText     Texte du pied de page
 * @param {string} [params.headerGradient] Dégradé CSS du bandeau, défaut vert forêt
 * @param {string} [params.accentColor]    Couleur d'accent (label + bouton email), défaut or ambré
 */
const renderBrandedEmail = ({
  title,
  bodyHtml,
  contactWhatsapp,
  contactEmail,
  brandLabel,
  footerText,
  headerGradient = "linear-gradient(135deg,#1B4332,#2D6A4F)",
  accentColor = "#E8C47A",
}) => `
<div style="background:#FAFAF8;padding:32px 16px;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(27,67,50,0.12);">
    <div style="background:${headerGradient};padding:32px 32px 24px;text-align:center;">
      <div style="color:${accentColor};font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">${escapeHtml(brandLabel)}</div>
      <div style="color:#FFFFFF;font-size:22px;font-weight:700;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(title)}</div>
    </div>
    <div style="padding:32px;color:#1A1A1A;font-size:15px;line-height:1.65;">
      ${bodyHtml}
    </div>
    ${renderContactBlockHtml({ contactWhatsapp, contactEmail, accentColor: "#C9903A" })}
    <div style="background:#F5F0E8;padding:20px 32px;text-align:center;font-size:12px;color:#7A7A7A;">
      ${escapeHtml(footerText)}
    </div>
  </div>
</div>`;

/**
 * @param {string} title    Titre affiché dans le bandeau (ex: nom du programme)
 * @param {string} bodyHtml Corps du message, déjà en HTML (paragraphes, etc.)
 * @param {object} course   Document NumsalCourse (pour les coordonnées de contact)
 */
const renderNumsalEmail = ({ title, bodyHtml, course }) =>
  renderBrandedEmail({
    title,
    bodyHtml,
    contactWhatsapp: course?.contactWhatsapp,
    contactEmail: course?.contactEmail,
    brandLabel: "NumSAL",
    footerText: "AMP BÉNIN — NumSAL · Ceci est un message automatique.",
  });

module.exports = {
  renderBrandedEmail,
  renderNumsalEmail,
  renderContactBlockHtml,
  renderContactBlockText,
  escapeHtml,
};
