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

const validateFileExists = async (filePath, isCloudinary = false) => {
  try {
    if (!filePath) return false;

    if (isCloudinary) {
      try {
        const result = await cloudinary.api.resource(filePath, {
          resource_type: "raw",
        });
        return result && result.secure_url;
      } catch (error) {
        return false;
      }
    } else {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(UPLOADS_DIR, filePath);
      await fsPromises.access(fullPath, fs.constants.F_OK);
      const stats = await fsPromises.stat(fullPath);
      return stats.isFile() && stats.size > 0;
    }
  } catch (error) {
    return false;
  }
};

const getFullPath = (filePath) => {
  if (!filePath) return null;
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(UPLOADS_DIR, filePath);
};

const downloadFromCloudinary = async (publicId, tempPath) => {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: "raw",
    });
    const response = await axios({
      method: "get",
      url: result.secure_url,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    throw new Error(`Failed to download from Cloudinary: ${error.message}`);
  }
};

const generateSecureFileName = (originalName) => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = path.extname(originalName);
  const baseName = path
    .basename(originalName, extension)
    .replace(/[^a-zA-Z0-9]/g, "_");
  return `${baseName}_${timestamp}_${randomString}${extension}`;
};

exports.uploadPDF = async (req, res) => {
  let tempFilePath = null;
  let savedPdf = null;
  let tempDownloadPath = null;

  try {
    console.log("PDF upload started");
    const isProduction = process.env.NODE_ENV === "production";

    if (!isProduction) {
      await ensureUploadsDirectory();
    }

    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const { filename, originalname, size } = req.file;
    let finalPath, publicId, cloudinaryUrl;

    if (isProduction) {
      publicId = req.file.public_id;
      cloudinaryUrl = req.file.path;
      finalPath = publicId;

      tempDownloadPath = path.join(UPLOADS_DIR, `temp_${Date.now()}.pdf`);
      await ensureUploadsDirectory();
      await downloadFromCloudinary(publicId, tempDownloadPath);
      tempFilePath = tempDownloadPath;
    } else {
      tempFilePath = req.file.path;
      const secureFileName = generateSecureFileName(originalname);
      finalPath = path.join(UPLOADS_DIR, secureFileName);

      try {
        await fsPromises.copyFile(tempFilePath, finalPath);
        console.log("File copied to secure location:", finalPath);

        const finalFileExists = await validateFileExists(finalPath);
        if (!finalFileExists) {
          throw new Error("Failed to copy file to secure location");
        }
      } catch (copyError) {
        console.error("File copy error:", copyError);
        throw new Error("Failed to secure uploaded file");
      }
      finalPath = secureFileName;
    }

    console.log("Processing file:", originalname, "Size:", size);

    const extractedData = await pdfService.extractText(tempFilePath);
    console.log(
      "Text extraction completed. Length:",
      extractedData.text.length
    );

    if (!extractedData.text || extractedData.text.trim().length === 0) {
      if (isProduction && publicId) {
        await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
      } else if (finalPath) {
        await fsPromises.unlink(getFullPath(finalPath)).catch(console.error);
      }
      throw new Error("PDF contains no extractable text content");
    }

    const chunks = pdfService.chunkText(extractedData.text);
    console.log("Created", chunks.length, "chunks");

    if (chunks.length === 0) {
      if (isProduction && publicId) {
        await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
      } else if (finalPath) {
        await fsPromises.unlink(getFullPath(finalPath)).catch(console.error);
      }
      throw new Error("Failed to create text chunks from PDF content");
    }

    const pdf = new PDF({
      filename: isProduction ? publicId : filename,
      originalName: originalname,
      path: finalPath,
      cloudinaryUrl: isProduction ? cloudinaryUrl : null,
      isCloudinary: isProduction,
      size,
      pageCount: extractedData.pageCount,
      content: extractedData.text,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        embedding: [],
      })),
      embeddingStatus: "pending",
      uploadedAt: new Date(),
    });

    savedPdf = await pdf.save();
    console.log("PDF saved to database with ID:", savedPdf._id);

    try {
      if (tempDownloadPath) {
        await fsPromises.unlink(tempDownloadPath);
        console.log("Temporary download file cleaned up:", tempDownloadPath);
      }
      if (
        !isProduction &&
        tempFilePath &&
        tempFilePath !== getFullPath(finalPath)
      ) {
        await fsPromises.unlink(tempFilePath);
        console.log("Temporary file cleaned up:", tempFilePath);
      }
    } catch (cleanupError) {
      console.warn("Failed to cleanup temp file:", cleanupError.message);
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

    if (tempFilePath) {
      try {
        await fsPromises.unlink(tempFilePath);
      } catch (cleanupError) {
        console.warn(
          "Failed to cleanup temp file on error:",
          cleanupError.message
        );
      }
    }

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

    if (savedPdf) {
      try {
        await PDF.findByIdAndDelete(savedPdf._id);
        if (savedPdf.isCloudinary && savedPdf.path) {
          await cloudinary.uploader.destroy(savedPdf.path, {
            resource_type: "raw",
          });
        } else if (savedPdf.path && (await validateFileExists(savedPdf.path))) {
          const fullPath = getFullPath(savedPdf.path);
          await fsPromises.unlink(fullPath);
        }
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

    const fileExists = await validateFileExists(pdf.path, pdf.isCloudinary);
    if (!fileExists) {
      console.error("PDF file not found for embedding processing:", pdf.path);
      pdf.embeddingStatus = "failed";
      pdf.embeddingError = "File not found";
      await pdf.save();
      return;
    }

    if (pdf.isCloudinary) {
      tempFilePath = path.join(UPLOADS_DIR, `temp_embedding_${Date.now()}.pdf`);
      await ensureUploadsDirectory();
      await downloadFromCloudinary(pdf.path, tempFilePath);
    }

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
        const fileExists = await validateFileExists(pdf.path, pdf.isCloudinary);
        const pdfObj = pdf.toObject();
        return {
          ...pdfObj,
          fileExists,
        };
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
      "embeddingStatus embeddingProgress embeddingError path isCloudinary"
    );

    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const fileExists = await validateFileExists(pdf.path, pdf.isCloudinary);

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

    const fileExists = await validateFileExists(pdf.path, pdf.isCloudinary);
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

    if (pdf.isCloudinary) {
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
    } else {
      const fullPath = getFullPath(pdf.path);
      console.log("PDF found:", pdf.originalName, "Path:", fullPath);

      const fileExists = await validateFileExists(pdf.path, false);
      if (!fileExists) {
        console.log("File not found on disk:", fullPath);

        pdf.embeddingStatus = "failed";
        pdf.embeddingError = "File not found on disk";
        await pdf.save().catch(console.error);

        return res.status(404).json({
          error: "PDF file not found on disk",
          details:
            "The physical file is missing. Please re-upload the document.",
          needsReupload: true,
        });
      }

      console.log("File exists, serving PDF...");

      let stat;
      try {
        stat = await fsPromises.stat(fullPath);
      } catch (statError) {
        console.error("Failed to get file stats:", statError);
        return res.status(500).json({ error: "Failed to access PDF file" });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", stat.size);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(pdf.originalName)}"`
      );
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
        "Content-Length, Content-Range, Accept-Ranges"
      );

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        res.setHeader("Content-Length", chunksize);

        const stream = fs.createReadStream(fullPath, { start, end });
        stream.pipe(res);
      } else {
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
      }
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
      if (pdf.isCloudinary) {
        await cloudinary.uploader.destroy(pdf.path, { resource_type: "raw" });
        console.log("File deleted from Cloudinary:", pdf.path);
      } else {
        const fullPath = getFullPath(pdf.path);
        const fileExists = await validateFileExists(pdf.path, false);
        if (fileExists) {
          await fsPromises.unlink(fullPath);
          console.log("File deleted from disk:", fullPath);
        } else {
          console.log("File already missing from disk:", fullPath);
        }
      }
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

    const fileExists = await validateFileExists(pdf.path, pdf.isCloudinary);

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
