/**
 * Script : migration ponctuelle de la liste d'actualités codée en dur
 * (actualites.astro) vers la collection CMS `Article` (Mongo). À exécuter
 * une seule fois :
 *
 *   node scripts/seedArticles.js
 *
 * Ces 5 entrées sont des cartes "teaser" qui pointent encore vers des pages
 * historiques codées en dur (`externalLink`) — leur contenu long (body) sera
 * migré dans une phase ultérieure du plan de refonte (phase 4).
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getArticleModel = require("../models/cms/Article");

const ARTICLES = [
  {
    slug: "numsal-tori-bossito",
    title: "Lancement du projet NumSAL - 2026",
    date: "En cours…",
    excerpt: "AMP BENIN, à travers sa section SNIE, lance officiellement le projet NumSAL pour former les jeunes et promouvoir l'entrepreneuriat numérique. Projet soutenu par le programme FP2E / NexT Impact (Sèmè City) et financé par la Banque mondiale.",
    coverImage: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903903/ong-site/images/numsal/Lancement-numsal.jpg",
    externalLink: "/actualites/numsal-tori-bossito",
  },
  {
    slug: "16jours-2025",
    title: "Campagne des 16 Jours d'activisme contre les VBG — 2025",
    date: "Du 25 novembre au 10 décembre 2025",
    excerpt: "AMP BENIN, à travers la Section du Féminisme et de Promotion de la Femme, s'est engagée pour l'élimination des VBG dans nos communautés.",
    coverImage: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto:good,w_1920/v1780903906/ong-site/images/16jours/Lancement-16jours.webp",
    externalLink: "/16jours",
  },
  {
    slug: "campagne-mycountry229-paix-benin",
    title: "Lancement de la campagne MYCOUNTRY229 pour la paix",
    date: "Du 11 au 24 août 2025",
    excerpt: "AMP BENIN mobilise les jeunes à travers tout le pays pour promouvoir la paix et la cohésion sociale.",
    coverImage: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903905/ong-site/images/campagne-mycountry229-paix-benin.png",
    externalLink: "/actualites/campagne-mycountry229-paix-benin",
  },
  {
    slug: "16jours-2024",
    title: "Rapport de fin des 16 Jours d'activisme 2024",
    date: "Du 25 novembre au 25 décembre 2024",
    excerpt: "AMP BENIN, à travers la Section du Féminisme et de Promotion de la Femme, s'est engagée pour l'élimination des VBG dans nos communautés.",
    coverImage: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903907/ong-site/images/16jours/atelier1.webp",
    externalLink: "/16jours/article",
  },
  {
    slug: "forum-jeunesse-odd",
    title: "Forum des jeunes pour le développement durable",
    date: "15 juin 2024",
    excerpt: "Une centaine de jeunes se sont réunis à Cotonou pour échanger sur les enjeux des ODD au Bénin.",
    coverImage: "https://res.cloudinary.com/diongmuh8/image/upload/f_auto,q_auto,w_800/v1780903909/ong-site/images/news2.webp",
    externalLink: "/actualites/forum-jeunesse-odd",
  },
];

async function seed() {
  try {
    await connectDB();
    const Article = getArticleModel();

    let created = 0;
    let updated = 0;

    for (const item of ARTICLES) {
      const result = await Article.findOneAndUpdate(
        { slug: item.slug },
        {
          ...item,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
        { new: true, upsert: true, rawResult: true }
      );

      if (result.lastErrorObject?.updatedExisting) updated++;
      else created++;
    }

    console.log(`✅ Articles migrés : ${created} créés, ${updated} mis à jour`);
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED ARTICLES :", err);
    process.exit(1);
  }
}

seed();
