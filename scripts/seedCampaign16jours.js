/**
 * Script : migration ponctuelle de la campagne "16 jours d'activisme"
 * vers la collection CMS `Campaign` (Mongo). À exécuter une seule fois :
 *
 *   node scripts/seedCampaign16jours.js
 *
 * - `sections` (actuImages/stats/timeline/gallery) : retypées à l'identique
 *   depuis les composants Astro correspondants (petits tableaux).
 * - `dailyArticles` (j3 à j16) : EXTRAITES PROGRAMMATIQUEMENT depuis les
 *   fichiers .astro existants du frontend (pas retapées à la main, pour
 *   éviter tout risque de coquille sur ~14 x 1000 mots de contenu éditorial).
 *   Le script lit chaque fichier `amp-benin-site/src/pages/16jours/jN.astro`
 *   et extrait le HTML placé dans la branche de repli (celle rendue quand
 *   aucun contenu CMS n'est encore présent — voir le `{cmsBody ? (...) : (
 *   <> ... </>)}` ajouté dans chaque page).
 *
 * Chemin du frontend : par défaut `../../amp-benin-site` (structure de ce
 * dépôt). Surchageable via la variable d'environnement FRONTEND_ROOT si la
 * disposition des dossiers diffère sur une autre machine.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");
const getCampaignModel = require("../models/cms/Campaign");

const FRONTEND_ROOT =
  process.env.FRONTEND_ROOT || path.resolve(__dirname, "../../amp-benin-site");
const DAYS_DIR = path.join(FRONTEND_ROOT, "src/pages/16jours");

const START_MARKER = ") : (\n      <>";
const END_MARKER = "\n      </>\n    )}\n  </main>";

// Résout le bloc {photos.map((_, i) => (...))} du jour 13 en 8 balises
// <a>/<img> concrètes, faute de quoi l'expression JS littérale se
// retrouverait telle quelle dans le HTML stocké en base.
function resolveJ13Gallery(html) {
  const mapBlockRegex = /\{photos\.map\(\(_, i\) => \([\s\S]*?\)\)\}/;
  if (!mapBlockRegex.test(html)) return html;

  const resolved = Array.from({ length: 8 })
    .map((_, i) => {
      const n = i + 1;
      return `<a href="/images/16jours/${n}.webp" data-lightbox="webinaire-gallery" data-title="Photo ${n}"><img src="/images/16jours/${n}.webp" alt="Photo ${n}" class="rounded-lg shadow-md w-full object-cover hover:opacity-90 transition" /></a>`;
    })
    .join("\n");

  return html.replace(mapBlockRegex, resolved);
}

function readNormalized(filePath) {
  // Les fichiers sources sont en CRLF (Windows) ; on normalise en LF pour
  // que les marqueurs de recherche (écrits en LF) matchent de façon fiable
  // quel que soit l'OS où ce script est exécuté.
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function extractDailyBody(day) {
  const filePath = path.join(DAYS_DIR, `j${day}.astro`);
  const raw = readNormalized(filePath);

  const startIdx = raw.indexOf(START_MARKER);
  const endIdx = raw.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Marqueurs de repli introuvables dans j${day}.astro — le fichier a-t-il été modifié depuis l'ajout du câblage CMS ?`
    );
  }

  const body = raw.slice(startIdx + START_MARKER.length, endIdx);
  return resolveJ13Gallery(body);
}

function extractTitle(day) {
  const filePath = path.join(DAYS_DIR, `j${day}.astro`);
  const raw = readNormalized(filePath);
  const match = raw.match(/title="([^"]+)"/);
  return match ? match[1] : `Jour ${day}`;
}

const SECTIONS = {
  actuImages: [
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903910/ong-site/images/16jours/1J16-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903911/ong-site/images/16jours/1J15-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903912/ong-site/images/16jours/1J14-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903956/ong-site/images/16jours/4.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903956/ong-site/images/16jours/5.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903948/ong-site/images/16jours/1J12-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903945/ong-site/images/16jours/1J11-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903946/ong-site/images/16jours/2J11-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903947/ong-site/images/16jours/3J11-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903941/ong-site/images/16jours/1J9-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903942/ong-site/images/16jours/2J9-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903943/ong-site/images/16jours/3J9-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903925/ong-site/images/16jours/1J4-16jours-25.webp",
  ],
  stats: [
    { number: "1 sur 3", label: "Femmes victimes de violences au cours de leur vie" },
    { number: "40%", label: "Des victimes ne reçoivent aucune aide" },
    { number: "15-49 ans", label: "Tranche d’âge la plus touchée par les VBG" },
    { number: "70%", label: "Des agressions commises par un proche" },
  ],
  timeline: [
    { date: "11 Novembre", event: "Lancement d'appel à canditacture de recrutement des 300 Volontaires" },
    { date: "26 Novembre", event: "Lancement officiel des 16 Jours d'activisme contre les VBG" },
    { date: "27 Novembre", event: "Démarrage de la campagne digitale sur le plan national avec 300 jeunes classés dans 3équipes" },
    { date: "06 Décembre", event: "WEBINAIRE : Jeunes et le numérique sans les violences" },
    { date: "06 Décembre", event: "Démarrage des activités sur le terrain" },
    { date: "10 Décembre", event: "Marche ORANGEZ LE MONDE" },
  ],
  gallery: [
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903923/ong-site/images/16jours/2J3-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903989/ong-site/images/16jours/01-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903990/ong-site/images/16jours/02-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903991/ong-site/images/16jours/03-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903992/ong-site/images/16jours/04-16jours-25.webp",
    "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903992/ong-site/images/16jours/05-16jours-25.webp",
  ],
};

const DAYS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

async function seed() {
  try {
    if (!fs.existsSync(DAYS_DIR)) {
      throw new Error(
        `Dossier introuvable : ${DAYS_DIR}\nDéfinis FRONTEND_ROOT si le frontend n'est pas à côté de server-amp-sites.`
      );
    }

    await connectDB();
    const Campaign = getCampaignModel();

    const dailyArticles = DAYS.map((day) => ({
      day,
      title: extractTitle(day),
      body: extractDailyBody(day),
      gallery: [],
    }));

    await Campaign.findOneAndUpdate(
      { slug: "16jours-2025" },
      { slug: "16jours-2025", sections: SECTIONS, dailyArticles, status: "PUBLISHED" },
      { upsert: true }
    );

    console.log(`✅ Campagne 16jours-2025 migrée (${dailyArticles.length} articles journaliers extraits)`);
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED CAMPAGNE 16 JOURS :", err.message);
    process.exit(1);
  }
}

seed();
