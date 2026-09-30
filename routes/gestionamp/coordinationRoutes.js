const express = require("express");
const router = express.Router();

const makeSpaceCrud = require("../../controllers/gestionamp/makeSpaceCrud");
const getCoordinationCommunaleModel = require("../../models/gestionamp/CoordinationCommunale");
const getUserModel = require("../../models/gestionamp/User");
const getActivityModel = require("../../models/gestionamp/Activity");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

// Détail de ce qui est rattaché à CETTE coordination — consultable via
// GET /:id/usage (bouton "🔍 Vérifier" côté admin) et réutilisé par
// makeSpaceCrud.js#remove pour bloquer la suppression tant que ce n'est
// pas vide (décision utilisateur, 2026-09-30).
const getUsage = async (id) => {
  const User = getUserModel();
  const Activity = getActivityModel();
  const [users, activities] = await Promise.all([
    User.find({ coordinationCommunaleId: id }).select("name role"),
    Activity.find({ coordinationCommunaleId: id }).select("title status").limit(50),
  ]);
  return { userCount: users.length, activityCount: activities.length, users, activities };
};

const ctrl = makeSpaceCrud(getCoordinationCommunaleModel, "Coordination Communale", getUsage);

// 🔐 Toutes les routes sont ADMIN uniquement
router.use(authMiddleware, roleMiddleware("ADMIN"));

router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);
router.get("/:id/usage", ctrl.usage);
router.patch("/:id/status", ctrl.toggleStatus);

module.exports = router;
