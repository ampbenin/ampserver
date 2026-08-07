const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../controllers/siteSettingsController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

// Même limite que les autres uploads d'image de ce backend (logo
// partenaire, preuve de tâche) : 10 Mo, images uniquement.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

router.get("/", ctrl.getSiteSettings); // public

router.patch(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  upload.fields([{ name: "ampLogo", maxCount: 1 }]),
  ctrl.updateSiteSettings
);

module.exports = router;
