// Domaine du frontend pour les liens CMS (gestionamp : connexion,
// réinitialisation de mot de passe, invitation) et de l'espace volontaire
// ("mon-espace") — tous deux servis sous le sous-domaine programme.ampbenin.org
// depuis la bascule du 2026-11-24 (ampbenin.org/mon-espace/* et
// ampbenin.org/reset-password redirigeaient déjà vers ce sous-domaine ;
// pointer directement dessus épargne ce saut). Partagé entre
// gestionamp/authController.js, gestionamp/userController.js,
// volunteerApplicationController.js et volunteerAuthController.js — un seul
// endroit à changer si ce sous-domaine change encore.
module.exports = process.env.PROGRAMME_FRONTEND_URL || "https://programme.ampbenin.org";
