const express = require("express");
const router = express.Router();

const makeSpaceCrud = require("../../controllers/gestionamp/makeSpaceCrud");
const getInstitutionSpecialiseeModel = require("../../models/gestionamp/InstitutionSpecialisee");
const getUserModel = require("../../models/gestionamp/User");
const getActivityModel = require("../../models/gestionamp/Activity");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const isInUse = async (id) => {
  const User = getUserModel();
  const Activity = getActivityModel();
  const [userCount, activityCount] = await Promise.all([
    User.countDocuments({ institutionSpecialiseeId: id }),
    Activity.countDocuments({ institutionSpecialiseeId: id }),
  ]);
  return userCount > 0 || activityCount > 0;
};

const ctrl = makeSpaceCrud(getInstitutionSpecialiseeModel, "Institution Spécialisée", isInUse);

// 🔐 Toutes les routes sont ADMIN uniquement
router.use(authMiddleware, roleMiddleware("ADMIN"));

router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

module.exports = router;
