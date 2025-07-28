const express = require("express");
const upload = require("../middleware/upload");
const pdfController = require("../controllers/pdfController");

const router = express.Router();

router.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Range"
  );
  res.header(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

router.post("/upload", upload.single("pdf"), pdfController.uploadPDF);
router.get("/", pdfController.getPDFs);
router.get("/:id", pdfController.getPDF);
router.get("/:id/embedding-status", pdfController.getEmbeddingStatus);
router.get("/:id/repair", pdfController.repairPDF);
router.post("/:id/reprocess-embeddings", pdfController.reprocessEmbeddings);
router.delete("/:id", pdfController.deletePDF);

module.exports = router;
