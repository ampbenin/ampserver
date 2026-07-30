/**
 * Script : migration ponctuelle du tableau `jobsData` codé en dur
 * (JobsCarousel.jsx) vers la collection CMS `JobPosting` (Mongo). À exécuter
 * une seule fois :
 *
 *   node scripts/seedJobPostings.js
 */

require("dotenv").config();
const connectDB = require("../config/db");
const getJobPostingModel = require("../models/cms/JobPosting");

const JOBS = [
  { title: "1 Structure pour la réalisation d'études de terrain et la planification du projet NumSAL", category: "Consultance", location: "Tori-Bossito", applyUrl: "https://drive.google.com/file/d/1Ve5iz0Zwodwhwy3av0CfaU4iX6BP-xyU/view?usp=drive_link" },
  { title: "1 Structure spécialisée pour l'installation, la fourniture de connexion internet et la maintenance", category: "Consultance", location: "Bénin", applyUrl: "https://drive.google.com/file/d/1qkM_By6IGZvbW2gnV7HmfYtEbsKz7VGn/view?usp=sharing" },
  { title: "4 Consultants individuels pour la conception de modules pédagogiques en compétences numériques – Projet NumSAL", category: "Consultance", location: "Bénin", applyUrl: "https://drive.google.com/file/d/1_lui4qod9aiNgVJgnH7z651T-ERhfaWq/view?usp=drive_link" },
  { title: "1 Éditeur pédagogique pour l'accompagnement à la conception des modules pédagogiques – Projet NumSAL", category: "Emploi", location: "Tori-Bossito", applyUrl: "https://drive.google.com/file/d/11b0Qqzv5Zgzep6vPyoBJifS17iszRVpG/view?usp=drive_link" },
  { title: "2 Coach-formateurs pour l'animation des modules de formation en compétences numériques – Projet NumSAL", category: "Emploi", location: "Bénin", applyUrl: "https://drive.google.com/file/d/1BqkU64zoGN8uNjnB5pkG__XaXYnrjLZV/view?usp=sharing" },
  { title: "2 Coachs assistants pour l'appui à l'animation des formations en compétences numériques – Projet NumSAL", category: "Emploi", location: "Tori-Bossito", applyUrl: "https://drive.google.com/file/d/1qr_tySQgb7HFyfbz2xF9QAtzBn7vk3bg/view?usp=sharing" },
];

async function seed() {
  try {
    await connectDB();
    const JobPosting = getJobPostingModel();

    let created = 0;
    for (let i = 0; i < JOBS.length; i++) {
      const existing = await JobPosting.findOne({ title: JOBS[i].title });
      if (existing) continue;
      await JobPosting.create({ ...JOBS[i], order: i, status: "PUBLISHED" });
      created++;
    }

    console.log(`✅ Offres migrées : ${created} créées (${JOBS.length - created} déjà existantes)`);
    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR SEED JOB POSTINGS :", err);
    process.exit(1);
  }
}

seed();
