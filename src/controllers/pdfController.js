const PDF = require("../models/PDF");
const pdfService = require("../services/pdfService");
const vectorService = require("../services/vectorService");
const fsPromises = require("fs").promises;
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const axios = require("axios");

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const ensureUploadsDirectory = async () => {
  try {
    await fsPromises.access(UPLOADS_DIR);
  } catch (error) {
    await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });
    console.log("Created uploads directory:", UPLOADS_DIR);
  }
};

const validateFileExists = async (filePath) => {
  try {
    if (!filePath) return false;
    const result = await cloudinary.api.resource(filePath, {
      resource_type: "raw",
    });
    return result && result.secure_url;
  } catch (error) {
    return false;
  }
};

const downloadFromCloudinary = async (url, tempPath) => {
  try {
    console.log("Downloading from URL:", url);
    const response = await axios({
      method: "get",
      url: url,
      responseType: "stream",
      timeout: 30000,
    });

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    throw new Error(
      `Failed to download from Cloudinary: ${error.message || error}`
    );
  }
};

exports.uploadPDF = async (req, res) => {
  let tempDownloadPath = null;
  let savedPdf = null;

  try {
    console.log("PDF upload started");
    console.log("Request file:", req.file);

    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const { originalname, size, filename } = req.file;
    const publicId = req.file.public_id || filename;
    const cloudinaryUrl = req.file.path;

    console.log("File details:", {
      originalname,
      size,
      publicId,
      cloudinaryUrl,
    });

    if (!publicId || !cloudinaryUrl) {
      throw new Error(
        "File upload to Cloudinary failed - missing file details"
      );
    }

    tempDownloadPath = path.join(UPLOADS_DIR, `temp_${Date.now()}.pdf`);
    await ensureUploadsDirectory();

    console.log("Downloading file for processing...");
    await downloadFromCloudinary(cloudinaryUrl, tempDownloadPath);

    console.log("Processing file:", originalname, "Size:", size);

    const extractedData = await pdfService.extractText(tempDownloadPath);
    console.log(
      "Text extraction completed. Length:",
      extractedData.text.length
    );

    if (!extractedData.text || extractedData.text.trim().length === 0) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
      throw new Error("PDF contains no extractable text content");
    }

    const chunks = pdfService.chunkText(extractedData.text);
    console.log("Created", chunks.length, "chunks");

    if (chunks.length === 0) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
      throw new Error("Failed to create text chunks from PDF content");
    }

    const pdf = new PDF({
      filename: publicId,
      originalName: originalname,
      path: publicId,
      cloudinaryUrl: cloudinaryUrl,
      isCloudinary: true,
      size: size || 0,
      pageCount: extractedData.pageCount,
      content: extractedData.text,
      chunks: chunks.map((chunk) => ({ ...chunk, embedding: [] })),
      embeddingStatus: "pending",
      uploadedAt: new Date(),
    });

    savedPdf = await pdf.save();
    console.log("PDF saved to database with ID:", savedPdf._id);

    if (tempDownloadPath) {
      await fsPromises.unlink(tempDownloadPath);
      console.log("Temporary download file cleaned up:", tempDownloadPath);
    }

    processEmbeddingsAsync(savedPdf._id);

    res.status(201).json({
      id: savedPdf._id,
      filename: savedPdf.originalName,
      pageCount: savedPdf.pageCount,
      size: savedPdf.size,
      uploadedAt: savedPdf.uploadedAt,
      embeddingStatus: savedPdf.embeddingStatus,
    });
  } catch (error) {
    console.error("Upload error:", error);

    if (tempDownloadPath) {
      try {
        await fsPromises.unlink(tempDownloadPath);
      } catch (cleanupError) {
        console.warn(
          "Failed to cleanup temp download file:",
          cleanupError.message
        );
      }
    }

    if (savedPdf && savedPdf.path) {
      try {
        await PDF.findByIdAndDelete(savedPdf._id);
        await cloudinary.uploader.destroy(savedPdf.path, {
          resource_type: "raw",
        });
      } catch (cleanupError) {
        console.warn(
          "Failed to cleanup saved PDF on error:",
          cleanupError.message
        );
      }
    }

    res.status(500).json({
      error: "Failed to process PDF",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Please try again",
    });
  }
};

async function processEmbeddingsAsync(pdfId) {
  let pdf = null;
  let tempFilePath = null;

  try {
    pdf = await PDF.findById(pdfId);
    if (!pdf) {
      console.error("PDF not found for embedding processing:", pdfId);
      return;
    }

    if (!pdf.cloudinaryUrl) {
      console.error("No Cloudinary URL found for PDF:", pdfId);
      pdf.embeddingStatus = "failed";
      pdf.embeddingError = "No file URL available";
      await pdf.save();
      return;
    }

    tempFilePath = path.join(UPLOADS_DIR, `temp_embedding_${Date.now()}.pdf`);
    await ensureUploadsDirectory();
    await downloadFromCloudinary(pdf.cloudinaryUrl, tempFilePath);

    pdf.embeddingStatus = "processing";
    pdf.embeddingProgress = 0;
    pdf.embeddingError = undefined;
    await pdf.save();

    const chunkTexts = pdf.chunks.map((chunk) => chunk.text);

    if (chunkTexts.length === 0) {
      throw new Error("No text chunks available for embedding");
    }

    console.log(
      `Starting embedding generation for ${chunkTexts.length} chunks`
    );

    try {
      const embeddings = await vectorService.generateEmbeddings(chunkTexts);

      for (let i = 0; i < pdf.chunks.length; i++) {
        pdf.chunks[i].embedding = embeddings[i] || [];
        pdf.chunks[i].embeddingModel = "text-embedding-004";
        pdf.embeddingProgress = Math.round(((i + 1) / pdf.chunks.length) * 100);

        if (i % 5 === 0 || i === pdf.chunks.length - 1) {
          await pdf.save();
          console.log(`Embedding progress: ${pdf.embeddingProgress}%`);
        }
      }

      pdf.embeddingStatus = "completed";
      pdf.embeddingProgress = 100;
      pdf.embeddingError = undefined;
      await pdf.save();

      console.log(`Embeddings completed successfully for PDF ${pdfId}`);
    } catch (embeddingError) {
      console.error(
        `Embedding generation failed for PDF ${pdfId}:`,
        embeddingError
      );
      pdf.embeddingStatus = "failed";
      pdf.embeddingProgress = 0;
      pdf.embeddingError = embeddingError.message;
      await pdf.save();
    }
  } catch (error) {
    console.error(
      `Critical error in embedding processing for PDF ${pdfId}:`,
      error
    );
    try {
      if (pdf) {
        pdf.embeddingStatus = "failed";
        pdf.embeddingError = error.message;
        await pdf.save();
      }
    } catch (updateError) {
      console.error("Failed to update embedding status on error:", updateError);
    }
  } finally {
    if (tempFilePath) {
      try {
        await fsPromises.unlink(tempFilePath);
        console.log("Temporary embedding file cleaned up:", tempFilePath);
      } catch (cleanupError) {
        console.warn(
          "Failed to cleanup temp embedding file:",
          cleanupError.message
        );
      }
    }
  }
}

exports.getPDFs = async (req, res) => {
  try {
    const pdfs = await PDF.find()
      .select(
        "_id originalName pageCount size uploadedAt embeddingStatus embeddingProgress path isCloudinary"
      )
      .sort({ uploadedAt: -1 });

    const validatedPdfs = await Promise.all(
      pdfs.map(async (pdf) => {
        const fileExists = await validateFileExists(pdf.path);
        const pdfObj = pdf.toObject();
        return { ...pdfObj, fileExists };
      })
    );

    res.json(validatedPdfs);
  } catch (error) {
    console.error("Get PDFs error:", error);
    res.status(500).json({ error: "Failed to fetch PDFs" });
  }
};

exports.getEmbeddingStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    const pdf = await PDF.findById(id).select(
      "embeddingStatus embeddingProgress embeddingError path"
    );

    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const fileExists = await validateFileExists(pdf.path);

    res.json({
      status: pdf.embeddingStatus,
      progress: pdf.embeddingProgress || 0,
      error: pdf.embeddingError,
      fileExists,
    });
  } catch (error) {
    console.error("Get embedding status error:", error);
    res.status(500).json({ error: "Failed to get embedding status" });
  }
};

exports.reprocessEmbeddings = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    const pdf = await PDF.findById(id);

    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const fileExists = await validateFileExists(pdf.path);
    if (!fileExists) {
      return res.status(400).json({
        error: "PDF file not found",
        details: "The file is missing. Please re-upload the document.",
      });
    }

    pdf.embeddingStatus = "pending";
    pdf.embeddingProgress = 0;
    pdf.embeddingError = undefined;
    await pdf.save();

    processEmbeddingsAsync(pdf._id);

    res.json({ message: "Embedding reprocessing started" });
  } catch (error) {
    console.error("Reprocess embeddings error:", error);
    res.status(500).json({ error: "Failed to reprocess embeddings" });
  }
};

exports.getPDF = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    console.log("Getting PDF with ID:", id);

    const pdf = await PDF.findById(id);

    if (!pdf) {
      console.log("PDF not found in database");
      return res.status(404).json({ error: "PDF not found" });
    }

    if (pdf.cloudinaryUrl) {
      console.log("Redirecting to Cloudinary URL:", pdf.cloudinaryUrl);
      return res.redirect(pdf.cloudinaryUrl);
    }

    try {
      const result = await cloudinary.api.resource(pdf.path, {
        resource_type: "raw",
      });
      console.log("Redirecting to Cloudinary URL:", result.secure_url);
      return res.redirect(result.secure_url);
    } catch (cloudinaryError) {
      console.log("Cloudinary file not found:", pdf.path);
      pdf.embeddingStatus = "failed";
      pdf.embeddingError = "File not found in cloud storage";
      await pdf.save().catch(console.error);

      return res.status(404).json({
        error: "PDF file not found in cloud storage",
        details: "The file is missing. Please re-upload the document.",
        needsReupload: true,
      });
    }
  } catch (error) {
    console.error("Get PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch PDF" });
    }
  }
};

exports.deletePDF = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    const pdf = await PDF.findById(id);

    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    try {
      await cloudinary.uploader.destroy(pdf.path, { resource_type: "raw" });
      console.log("File deleted from Cloudinary:", pdf.path);
    } catch (fileError) {
      console.warn("File deletion error:", fileError.message);
    }

    await PDF.findByIdAndDelete(id);
    console.log("PDF deleted from database");

    const Conversation = require("../models/Conversation");
    await Conversation.deleteMany({ pdfId: id });
    console.log("Associated conversations deleted");

    res.json({ message: "PDF deleted successfully" });
  } catch (error) {
    console.error("Delete PDF error:", error);
    res.status(500).json({ error: "Failed to delete PDF" });
  }
};

exports.repairPDF = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    const pdf = await PDF.findById(id);
    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const fileExists = await validateFileExists(pdf.path);

    res.json({
      id: pdf._id,
      originalName: pdf.originalName,
      fileExists,
      path: pdf.path,
      canRepair: !fileExists,
      needsReupload: !fileExists,
    });
  } catch (error) {
    console.error("Repair check error:", error);
    res.status(500).json({ error: "Failed to check PDF status" });
  }
};
