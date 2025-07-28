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

router.post("/pdf/upload", upload.single("pdf"), pdfController.uploadPDF);
router.get("/pdfs", pdfController.getPDFs);

router.get("/pdf", (req, res) => {
  res.json({
    message: "PDF API endpoint",
    availableRoutes: [
      "GET /api/pdfs - Get all PDFs",
      "GET /api/pdf/:id - Get specific PDF",
      "POST /api/pdf/upload - Upload PDF",
      "DELETE /api/pdf/:id - Delete PDF",
    ],
  });
});

router.get("/pdf/:id", pdfController.getPDF);
router.get("/pdf/:id/embedding-status", pdfController.getEmbeddingStatus);
router.get("/pdf/:id/repair", pdfController.repairPDF);
router.post("/pdf/:id/reprocess-embeddings", pdfController.reprocessEmbeddings);
router.delete("/pdf/:id", pdfController.deletePDF);

router.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    availableRoutes: [
      "GET /api/pdfs",
      "GET /api/pdf/:id",
      "POST /api/pdf/upload",
      "DELETE /api/pdf/:id",
    ],
  });
});

module.exports = router;
