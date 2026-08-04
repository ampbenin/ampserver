const express = require("express");
const multer = require("multer");
const router = express.Router();

const ctrl = require("../../controllers/numsal/partnerController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo, même limite que routes/cms/media.js
});

// 🌐 Public — liste des partenaires (page /partenaires + tableau de bord admin)
router.get("/", ctrl.listPartners);

// 🔐 ADMIN — gestion des partenaires
// (/reorder et /upload-logo déclarés avant "/:id" pour ne pas être captés par le paramètre générique)
router.post("/", ...requireAdmin, ctrl.createPartner);
router.put("/reorder", ...requireAdmin, ctrl.reorderPartners);
router.post("/upload-logo", ...requireAdmin, upload.single("file"), ctrl.uploadLogo);
router.put("/:id", ...requireAdmin, ctrl.updatePartner);
router.delete("/:id", ...requireAdmin, ctrl.deletePartner);

module.exports = router;
