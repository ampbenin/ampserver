const express = require("express");
const router = express.Router();
const makeSimpleCrud = require("../../controllers/cms/makeSimpleCrud");
const getJobPostingModel = require("../../models/cms/JobPosting");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const ctrl = makeSimpleCrud(getJobPostingModel, "Offre");
const requireEditor = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

router.get("/admin", ...requireEditor, ctrl.adminList);
router.get("/admin/:id", ...requireEditor, ctrl.adminGetById);
router.post("/admin", ...requireEditor, ctrl.create);
router.put("/admin/:id", ...requireEditor, ctrl.update);
router.delete("/admin/:id", ...requireEditor, ctrl.remove);

router.get("/", ctrl.listPublished);

module.exports = router;
