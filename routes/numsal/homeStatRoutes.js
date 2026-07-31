const express = require("express");
const router = express.Router();

const ctrl = require("../../controllers/numsal/homeStatController");
const authMiddleware = require("../../middlewares/numsal/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const requireAdmin = [authMiddleware, roleMiddleware("ADMIN")];

// 🌐 Public — liste des statistiques (page d'accueil + tableau de bord admin)
router.get("/", ctrl.listHomeStats);

// 🔐 ADMIN — gestion des statistiques
// (/reorder déclaré avant "/:id" pour ne pas être capté par le paramètre générique)
router.post("/", ...requireAdmin, ctrl.createHomeStat);
router.put("/reorder", ...requireAdmin, ctrl.reorderHomeStats);
router.put("/:id", ...requireAdmin, ctrl.updateHomeStat);
router.delete("/:id", ...requireAdmin, ctrl.deleteHomeStat);

module.exports = router;
