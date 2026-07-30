const express = require("express");
const router = express.Router();
const makeSlugCrud = require("../../controllers/cms/makeSlugCrud");
const getInstitutionCmsModel = require("../../models/cms/Institution");
const authMiddleware = require("../../middlewares/gestionamp/authMiddleware");
const roleMiddleware = require("../../middlewares/gestionamp/roleMiddleware");

const ctrl = makeSlugCrud(getInstitutionCmsModel, "Institution");
const requireEditor = [authMiddleware, roleMiddleware("ADMIN", "EDITOR")];

router.get("/admin", ...requireEditor, ctrl.adminList);
router.get("/admin/:id", ...requireEditor, ctrl.adminGetById);
router.post("/admin", ...requireEditor, ctrl.create);
router.put("/admin/:id", ...requireEditor, ctrl.update);
router.delete("/admin/:id", ...requireEditor, ctrl.remove);

router.get("/", ctrl.listPublished);
router.get("/:slug", ctrl.getPublishedBySlug);

module.exports = router;
