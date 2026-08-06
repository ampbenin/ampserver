// ⚠️ dotenv.config() DOIT s'exécuter avant tout autre require() de ce
// fichier : plusieurs routes ci-dessous (ex. certificateRoute.js) importent
// à leur tour des middlewares qui lisent process.env.JWT_SECRET dès leur
// chargement (au niveau du module, pas dans une fonction). Comme Node met
// les modules en cache, si config/jwt.js est évalué une seule fois avant
// que les variables d'environnement soient chargées, son secret reste
// "gelé" à `undefined` pour tout le reste du processus — d'où l'erreur
// "secretOrPrivateKey must have a value" côté JWT.
require("dotenv").config();

// Sentry doit être initialisé le plus tôt possible, avant les autres
// require() applicatifs, pour pouvoir instrumenter tout ce qui suit. Sans
// SENTRY_DSN défini, le SDK ne plante pas : il reste simplement inactif
// (aucune erreur envoyée) — donc rien ne casse tant que la variable n'est
// pas encore configurée en production.
const Sentry = require("@sentry/node");
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "production",
  tracesSampleRate: 0.1,
});

const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");

const volunteerRoutes = require("./routes/volunteerRoute");
const certificateRoutes = require("./routes/certificateRoute");
const newsletterRoutes = require("./routes/newsletterRoute");
const contactRoutes = require("./routes/contactRoute");
const partnerRoutes = require("./routes/partnerRoute");
const memberRoutes = require("./routes/memberRoute");

const { errorHandler } = require("./middlewares/errorHandler");

// ==========================
// 🔧 ENV & DB
// ==========================
connectDB();

const app = express();

// ==========================
// 🔌 MIDDLEWARES GLOBAUX
// ==========================
app.use(express.json());

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

// ==========================
// 🌐 API EXISTANTE
// ==========================
app.use("/api/volunteers", volunteerRoutes);
app.use("/api/certificates", certificateRoutes);
// Système de programmes de volontariat (façon NumSAL) — remplace
// définitivement l'ancien /api/missions + /api/volunteer-form +
// /admin/volunteers (montage retiré, voir le plan de migration ;
// controllers/missionController.js, volunteerFormController.js,
// routes/missionRoute.js, routes/volunteerFormRoute.js et
// routes/admin/volunteers.js restent dans le repo mais ne sont plus montés).
app.use("/api/volunteer-programs", require("./routes/volunteerProgramRoute"));
app.use("/api/volunteer-applications", require("./routes/volunteerApplicationRoute"));
app.use("/api/volunteer-form-templates", require("./routes/volunteerFormTemplateRoute"));
// Comptes volontaires "Mon espace" (connexion, inscription, mot de passe).
app.use("/api/volunteer-auth", require("./routes/volunteerAuthRoute"));
// Suivi des tâches de mission par programme (soumissions + modération).
app.use("/api/volunteer-tasks", require("./routes/volunteerTaskRoute"));
// Compte partenaire (statistiques/impact en lecture seule + commentaires).
app.use("/api/volunteer-partner", require("./routes/volunteerProgramPartnerRoute"));
// Discipline & sanctions des volontaires (signalement, avertissement/
// suspension/bannissement, liste noire inter-programmes).
app.use("/api/volunteer-discipline", require("./routes/volunteerDisciplineRoute"));
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/partner-form", partnerRoutes);
app.use("/api/members", memberRoutes);

// ==========================
// 🔐 ADMIN EXISTANT
// ==========================
app.use("/admin/newsletters", require("./routes/admin/newsletter"));
app.use("/admin/contacts", require("./routes/admin/contact"));
app.use("/admin/members", require("./routes/admin/members"));
app.use("/admin/partners", require("./routes/admin/partners"));

// ===================================================
// 🚀 GESTION AMP BENIN (SOUS-SYSTÈME ISOLÉ)
// ===================================================

// Authentification
app.use(
  "/gestionamp/api/auth",
  require("./routes/gestionamp/authRoutes")
);

// Utilisateurs (ADMIN)
app.use(
  "/gestionamp/api/users",
  require("./routes/gestionamp/userRoutes")
);

// Espaces : Coordinations Communales / Institutions Spécialisées (ADMIN)
app.use(
  "/gestionamp/api/coordinations",
  require("./routes/gestionamp/coordinationRoutes")
);
app.use(
  "/gestionamp/api/institutions",
  require("./routes/gestionamp/institutionRoutes")
);

// Activités / Projets
app.use(
  "/gestionamp/api/activities",
  require("./routes/gestionamp/activityRoutes")
);

// Finances
app.use(
  "/gestionamp/api/finances",
  require("./routes/gestionamp/financeRoutes")
);

// Rapports
app.use(
  "/gestionamp/api/reports",
  require("./routes/gestionamp/reportRoutes")
);

// 🌐 API publique AMP (lecture seule)
const { publicApiLimiter } = require("./config/rateLimit");
app.use(
  "/gestionamp/api/public",
  publicApiLimiter,
  require("./routes/gestionamp/publicRoutes")
);

// ===================================================
// 📝 CMS AMP BENIN (contenu du site)
// ===================================================
app.use("/api/cms/pages", require("./routes/cms/pages"));
app.use("/api/cms/articles", require("./routes/cms/articles"));
app.use("/api/cms/programmes", require("./routes/cms/programmes"));
app.use("/api/cms/institutions", require("./routes/cms/institutions"));
app.use("/api/cms/actions", require("./routes/cms/actions"));
app.use("/api/cms/jobs", require("./routes/cms/jobs"));
app.use("/api/cms/campaigns", require("./routes/cms/campaigns"));
app.use("/api/cms/media", require("./routes/cms/media"));

// ===================================================
// 🎓 NUMSAL (plateforme d'apprentissage en ligne, sous-domaine dédié)
// ===================================================
app.use("/numsal/api/auth", require("./routes/numsal/authRoutes"));
app.use("/numsal/api/admin", require("./routes/numsal/adminRoutes"));
app.use("/numsal/api/courses", require("./routes/numsal/courseRoutes"));
app.use("/numsal/api/enrollments", require("./routes/numsal/enrollmentRoutes"));
app.use("/numsal/api/mentor-notes", require("./routes/numsal/mentorNoteRoutes"));
app.use("/numsal/api/partners", require("./routes/numsal/partnerRoutes"));
app.use("/numsal/api/form-templates", require("./routes/numsal/formTemplateRoutes"));
app.use("/numsal/api/home-stats", require("./routes/numsal/homeStatRoutes"));
app.use("/numsal/api/testimonials", require("./routes/numsal/testimonialRoutes"));

// ==========================
// ❌ GESTION DES ERREURS
// ==========================
// Capture toute erreur transmise via next(err) par les routes ci-dessus,
// avant notre propre errorHandler qui construit la réponse JSON envoyée
// au client (Sentry ne remplace pas errorHandler, il s'intercale juste
// avant pour observer l'erreur au passage).
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

// ==========================
// ▶️ DÉMARRAGE SERVEUR
// ==========================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur en cours sur le port ${PORT}`);
});
