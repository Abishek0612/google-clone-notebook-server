const PDF = require("../models/PDF");
const pdfService = require("../services/pdfService");
const fsPromises = require("fs").promises;
const fs = require("fs");
const path = require("path");

exports.uploadPDF = async (req, res) => {
  try {
    console.log("PDF upload started");

    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const { filename, originalname, path: filePath, size } = req.file;
    console.log("Processing file:", originalname, "Size:", size);

    const extractedData = await pdfService.extractText(filePath);
    console.log(
      "Text extraction completed. Length:",
      extractedData.text.length
    );

    const chunks = pdfService.chunkText(extractedData.text);
    console.log("Created", chunks.length, "chunks");

    const pdf = new PDF({
      filename,
      originalName: originalname,
      path: filePath,
      size,
      pageCount: extractedData.pageCount,
      content: extractedData.text,
      chunks,
    });

    await pdf.save();
    console.log("PDF saved to database with ID:", pdf._id);

    res.status(201).json({
      id: pdf._id,
      filename: pdf.originalName,
      pageCount: pdf.pageCount,
      size: pdf.size,
      uploadedAt: pdf.uploadedAt,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      error: "Failed to process PDF",
      details: error.message,
    });
  }
};

exports.getPDFs = async (req, res) => {
  try {
    const pdfs = await PDF.find()
      .select("_id originalName pageCount size uploadedAt")
      .sort({ uploadedAt: -1 });

    res.json(pdfs);
  } catch (error) {
    console.error("Get PDFs error:", error);
    res.status(500).json({ error: "Failed to fetch PDFs" });
  }
};

exports.getPDF = async (req, res) => {
  try {
    console.log("Getting PDF with ID:", req.params.id);

    const pdf = await PDF.findById(req.params.id);

    if (!pdf) {
      console.log("PDF not found in database");
      return res.status(404).json({ error: "PDF not found" });
    }

    console.log("PDF found:", pdf.originalName, "Path:", pdf.path);

    try {
      fs.accessSync(pdf.path, fs.constants.F_OK);
      console.log("File exists on disk");
    } catch (fileError) {
      console.log("File not found on disk:", pdf.path);
      return res.status(404).json({ error: "PDF file not found on disk" });
    }

    console.log("Serving PDF file...");

    const stat = fs.statSync(pdf.path);

    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Range"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range"
    );
    res.setHeader("X-Frame-Options", "ALLOWALL");

    const stream = fs.createReadStream(pdf.path);

    stream.on("error", (streamError) => {
      console.error("Stream error:", streamError);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream PDF" });
      }
    });

    stream.on("open", () => {
      console.log("PDF stream opened successfully");
    });

    stream.pipe(res);
  } catch (error) {
    console.error("Get PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch PDF" });
    }
  }
};

exports.deletePDF = async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);

    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    try {
      await fsPromises.unlink(pdf.path);
      console.log("File deleted from disk:", pdf.path);
    } catch (fileError) {
      console.log(
        "File deletion error (file may not exist):",
        fileError.message
      );
    }

    await PDF.findByIdAndDelete(req.params.id);
    console.log("PDF deleted from database");

    res.json({ message: "PDF deleted successfully" });
  } catch (error) {
    console.error("Delete PDF error:", error);
    res.status(500).json({ error: "Failed to delete PDF" });
  }
};
