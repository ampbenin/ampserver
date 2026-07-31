const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/partnerController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

// 🌐 Public — liste des partenaires (page /partenaires + tableau de bord admin)
router.get("/", ctrl.listPartners);

// 🔐 ADMIN — gestion des partenaires
// (/reorder déclaré avant "/:id" pour ne pas être capté par le paramètre générique)
router.post("/", ...requireAdmin, ctrl.createPartner);
router.put("/reorder", ...requireAdmin, ctrl.reorderPartners);
router.put("/:id", ...requireAdmin, ctrl.updatePartner);
router.delete("/:id", ...requireAdmin, ctrl.deletePartner);

module.exports = router;
