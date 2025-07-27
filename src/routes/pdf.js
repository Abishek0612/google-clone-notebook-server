const express = require("express");
const upload = require("../middleware/upload");
const pdfController = require("../controllers/pdfController");

const router = express.Router();

router.options("/:id", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Range"
  );
  res.status(200).end();
});

router.post("/upload", upload.single("pdf"), pdfController.uploadPDF);
router.get("/", pdfController.getPDFs);
router.get("/:id", pdfController.getPDF);
router.delete("/:id", pdfController.deletePDF);

module.exports = router;
