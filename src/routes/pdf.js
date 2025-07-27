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

// Add clear all endpoint for debugging
router.delete("/clear/all", async (req, res) => {
  try {
    const PDF = require("../models/PDF");
    const Conversation = require("../models/Conversation");

    await PDF.deleteMany({});
    await Conversation.deleteMany({});

    console.log("All PDFs and conversations cleared");
    res.json({ message: "All data cleared successfully" });
  } catch (error) {
    console.error("Clear error:", error);
    res.status(500).json({ error: "Failed to clear data" });
  }
});

module.exports = router;
