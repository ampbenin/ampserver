const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/personnelController");
const authMiddleware = require("../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../middlewares/gestionamp/roleMiddleware");

const requireStaff = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

router.get("/categories", ...requireStaff, ctrl.listCategories);
router.get("/", ...requireStaff, ctrl.listPersonnel);
router.post("/", ...requireStaff, ctrl.createPersonnel);
router.put("/:id", ...requireStaff, ctrl.updatePersonnel);
router.delete("/:id", ...requireStaff, ctrl.deletePersonnel);

module.exports = router;
