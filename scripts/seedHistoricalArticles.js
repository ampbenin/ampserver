/**
 * Script : migration ponctuelle des articles historiques restants
 * (Gogounou, Plaidoyer, MyCountry229 2025, campagne paix, NumSAL, récap
 * 16 jours) vers la collection CMS `Article` (Mongo). À exécuter une seule
 * fois, après les autres scripts de seed :
 *
 *   node scripts/seedHistoricalArticles.js
 *
 * Le corps de chaque article "enrobé" (Gogounou, Plaidoyer, campagne paix,
 * NumSAL, récap 16 jours) est EXTRAIT PROGRAMMATIQUEMENT du fichier .astro
 * réel — pas retapé à la main — en repérant le fragment JSX de repli
 * `{cmsBody ? (...) : (<> ... </>)}` ajouté dans chaque page et en isolant
 * ce qu'il contient. `mycountry229-2025` n'a pas ce fragment (ses données
 * volontaires/stats sont branchées directement, pas en blob HTML) — seuls
 * `testimonials`/`stats` sont migrés pour cette page.
 *
 * Chemin du frontend : par défaut `../../amp-benin-site` (structure de ce
 * dépôt), surchargeable via FRONTEND_ROOT.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");
const getArticleModel = require("../models/cms/Article");

const FRONTEND_ROOT =
  process.env.FRONTEND_ROOT || path.resolve(__dirname, "../../amp-benin-site");
const ARTICLES_DIR = path.join(FRONTEND_ROOT, "src/pages/actualites");

function readNormalized(fileName) {
  const filePath = path.join(ARTICLES_DIR, fileName);
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

// Isole le contenu de la branche de repli `{cmsBody ? (<Fragment .../>) : (
// <> ... </>)}` ajoutée dans chaque page — robuste aux variations
// d'indentation puisqu'on repère juste les marqueurs JSX `<>`/`</>` autour
// du `) : (` connu, plutôt que des blancs exacts.
function extractFallbackBody(fileName) {
  const raw = readNormalized(fileName);
  const ternaryIdx = raw.indexOf(") : (");
  if (ternaryIdx === -1) {
    throw new Error(`Marqueur "){ : (" introuvable dans ${fileName}`);
  }
  const openIdx = raw.indexOf("<>", ternaryIdx);
  if (openIdx === -1) throw new Error(`Fragment ouvrant "<>" introuvable dans ${fileName}`);
  const contentStart = openIdx + 2;
  const closeIdx = raw.indexOf("</>", contentStart);
  if (closeIdx === -1) throw new Error(`Fragment fermant "</>" introuvable dans ${fileName}`);
  return raw.slice(contentStart, closeIdx).trim();
}

const GOGOUNOU_GALLERY = [
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780848303/Capture1111_ap0rca.png", caption: "Focus groupe en ligne réunissant 34 jeunes participants de la commune de Gogounou (18-20 mai 2026)", label: "Focus Groupe" },
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780780745/famille_sori_hzaj8f.jpg", caption: "Activité communautaire de terrain dans l'arrondissement de Sori, commune de Gogounou (23 mai 2026)", label: "Terrain Sori" },
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780780745/ec_form_sori_cauntg.jpg", caption: "Session interactive animée par M. Fiacre TCHISSOU sur l'identification des contenus trompeurs", label: "Formation" },
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780780745/echange_foor_jlfltl.jpg", caption: "Les 20 jeunes relais communautaires engagés à diffuser les bonnes pratiques numériques dans leurs localités", label: "Relais Communautaires" },
];

const GOGOUNOU_STATS = [
  { value: "34", label: "Jeunes au focus groupe", suffix: "", icon: "👥" },
  { value: "20", label: "Relais communautaires formés", suffix: "", icon: "🎓" },
  { value: "300", label: "Jeunes touchés indirectement", suffix: "+", icon: "🌍" },
  { value: "3", label: "Jours de concertation participative", suffix: "", icon: "📅" },
];

const PLAIDOYER_GALLERY = [
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780848303/Capture1111_ap0rca.png", caption: "Vue d'ensemble du focus group réunissant leaders communautaires, jeunes et acteurs de la société civile", label: "Focus Group" },
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780848293/111111_oldags.png", caption: "Atelier participatif d'identification des formes de désinformation observées dans les communautés locales", label: "Atelier" },
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780904134/22_snb5gg.jpg", caption: "Séance de co-construction des stratégies et orientations du plan de plaidoyer communautaire", label: "Co-construction" },
  { image: "https://res.cloudinary.com/di21pnpda/image/upload/v1780780745/staff_sori_tvvtcx.jpg", caption: "Restitution collective et validation des orientations stratégiques du plan de plaidoyer communautaire", label: "Restitution" },
];

const PLAIDOYER_STATS = [
  { value: "4", suffix: "", label: "Formes de désinformation cartographiées" },
  { value: "5", suffix: "+", label: "Stratégies communautaires proposées" },
  { value: "1", suffix: "", label: "Plan de plaidoyer en cours de rédaction" },
  { value: "4", suffix: "", label: "Catégories d'acteurs mobilisés" },
];

const PLAIDOYER_PILLARS = [
  { icon: "🏘️", title: "Leaders communautaires", desc: "Relais locaux, jeunes et acteurs de la société civile réunis en focus group", color: "#7c4fcf" },
  { icon: "🔍", title: "Formes de désinformation identifiées", desc: "Rumeurs, contenus manipulés, fausses informations, données hors contexte", color: "#cf4f7c" },
  { icon: "📋", title: "Plan de plaidoyer en construction", desc: "Document stratégique co-construit pour influencer les décideurs publics", color: "#4f7ccf" },
  { icon: "🤝", title: "Approche participative", desc: "Co-construction incluant OSC, autorités locales, médias et communautés", color: "#4fcfaf" },
];

const MYCOUNTRY229_TESTIMONIALS = [
  { name: "Alice HOUNTONDJI", quote: "Heureuse d'avoir contribué à la paix numérique.", photo: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_400,h_400,c_fill,g_face/v1780903949/ong-site/images/16jours/1-Paneliste-16jours-25.webp" },
  { name: "Jean KOUASSI", quote: "Une belle expérience de cohésion et d'apprentissage.", photo: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_400,h_400,c_fill,g_face/v1780903950/ong-site/images/16jours/2-Paneliste-16jours-25.webp" },
  { name: "Mariam ISSA", quote: "J'ai appris à mieux lutter contre la désinformation.", photo: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_400,h_400,c_fill,g_face/v1780903952/ong-site/images/16jours/3-Paneliste-16jours-25.webp" },
  { name: "Dieudonné AHOUANSOU", quote: "La jeunesse béninoise peut être moteur de changement positif.", photo: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_400,h_400,c_fill/v1780903987/ong-site/images/mycountry229-2.png" },
  { name: "Clémentine ADJOVI", quote: "Cette mission a renforcé ma confiance en moi et mes compétences.", photo: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_400,h_400,c_fill/v1780903907/ong-site/images/16jours/atelier1.webp" },
];

const MYCOUNTRY229_STATS = [
  { value: "226", label: "Volontaires mobilisés" },
  { value: "2", label: "Équipes constituées" },
  { value: "14", label: "Jours de mobilisation digitale" },
  { value: "500K+", label: "Personnes touchées en ligne" },
];

async function seed() {
  try {
    if (!fs.existsSync(ARTICLES_DIR)) {
      throw new Error(
        `Dossier introuvable : ${ARTICLES_DIR}\nDéfinis FRONTEND_ROOT si le frontend n'est pas à côté de server-amp-sites.`
      );
    }

    await connectDB();
    const Article = getArticleModel();

    // 1. Gogounou (nouvel article, gallery+stats+body)
    await Article.findOneAndUpdate(
      { slug: "mycountry229-lutte-desinformation-gogounou" },
      {
        slug: "mycountry229-lutte-desinformation-gogounou",
        title: "MyCountry229 à Gogounou : Les jeunes mobilisés contre la désinformation numérique",
        excerpt: "34 jeunes en focus groupe, 20 relais communautaires formés : retour sur le projet MyCountry229 mené par AMP BENIN et DG Partners ONG à Gogounou.",
        coverImage: "https://res.cloudinary.com/di21pnpda/image/upload/v1780848303/Capture1111_ap0rca.png",
        gallery: GOGOUNOU_GALLERY,
        stats: GOGOUNOU_STATS,
        body: extractFallbackBody("mycountry229-lutte-desinformation-gogounou.astro"),
        status: "PUBLISHED",
        publishedAt: new Date("2026-05-23"),
      },
      { upsert: true }
    );

    // 2. Plaidoyer (nouvel article, gallery+stats+pillars+body)
    await Article.findOneAndUpdate(
      { slug: "mycountry229-redaction-plan-plaidoyer" },
      {
        slug: "mycountry229-redaction-plan-plaidoyer",
        title: "AMP BENIN : Focus group pour l'élaboration d'un plan de plaidoyer contre la désinformation",
        excerpt: "Un focus group participatif réunissant leaders communautaires, jeunes et société civile pour co-construire un plan de plaidoyer contre la désinformation au Bénin.",
        coverImage: "https://res.cloudinary.com/di21pnpda/image/upload/v1780848303/Capture1111_ap0rca.png",
        gallery: PLAIDOYER_GALLERY,
        stats: PLAIDOYER_STATS,
        pillars: PLAIDOYER_PILLARS,
        body: extractFallbackBody("mycountry229-redaction-plan-plaidoyer.astro"),
        status: "PUBLISHED",
        publishedAt: new Date("2026-06-01"),
      },
      { upsert: true }
    );

    // 3. MyCountry229 2025 (nouvel article, testimonials+stats seulement, pas de body)
    await Article.findOneAndUpdate(
      { slug: "mycountry229-2025" },
      {
        slug: "mycountry229-2025",
        title: "Résumé d'exécution du projet MyCountry229 – 2025",
        excerpt: "Synthèse de la campagne MyCountry229 (11–24 août 2025) avec volontaires, statistiques et actions clés.",
        testimonials: MYCOUNTRY229_TESTIMONIALS,
        stats: MYCOUNTRY229_STATS,
        status: "PUBLISHED",
        publishedAt: new Date("2025-08-25"),
      },
      { upsert: true }
    );

    // 4. Campagne paix (déjà seedée en phase 1 comme teaser — on ajoute juste le body)
    await Article.findOneAndUpdate(
      { slug: "campagne-mycountry229-paix-benin" },
      { body: extractFallbackBody("campagne-mycountry229-paix-benin.astro") },
      { upsert: true }
    );

    // 5. NumSAL (déjà seedé en phase 1 comme teaser — on ajoute juste le body)
    await Article.findOneAndUpdate(
      { slug: "numsal-tori-bossito" },
      { body: extractFallbackBody("numsal-tori-bossito.astro") },
      { upsert: true }
    );

    // 6. Récapitulatif 16 jours (nouvel article, slug distinct des teasers 16jours-2025/2024)
    await Article.findOneAndUpdate(
      { slug: "16jours-recap-2025" },
      {
        slug: "16jours-recap-2025",
        title: "Campagne 16 Jours d'Activisme 2025 : AMP BENIN renforce la lutte contre les VBG",
        excerpt: "Pour l'édition 2025 des 16 Jours d'Activisme, AMP BENIN a mené un projet innovant et collaboratif pour sensibiliser, outiller et mobiliser les communautés béninoises contre les VBG.",
        coverImage: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_1200/v1780903921/ong-site/images/16jours/og-image-v16.jpg",
        body: extractFallbackBody("16jours.astro"),
        status: "PUBLISHED",
        publishedAt: new Date("2025-12-15"),
      },
      { upsert: true }
    );

    console.log("✅ Articles historiques migrés (Gogounou, Plaidoyer, MyCountry229 2025, campagne paix, NumSAL, récap 16 jours)");
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED ARTICLES HISTORIQUES :", err.message);
    process.exit(1);
  }
}

seed();
