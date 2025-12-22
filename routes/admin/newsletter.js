const router = require("express").Router();
const controller = require("../../controllers/admin/newsletterController");

router.get("/", controller.getAll);
router.post("/send", controller.sendMail);
router.delete("/:id", controller.remove);

module.exports = router;
