const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadsDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = path.extname(file.originalname);
    const baseName = path
      .basename(file.originalname, extension)
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);

    const uniqueName = `${baseName}_${timestamp}_${randomString}${extension}`;
    cb(null, uniqueName);
  },
});

const cloudStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "pdfs",
    resource_type: "raw",
    public_id: (req, file) => {
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const baseName = path
        .basename(file.originalname, ".pdf")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 50);
      return `${baseName}_${timestamp}_${randomString}`;
    },
  },
});

const storage =
  process.env.NODE_ENV === "production" ? cloudStorage : localStorage;

const fileFilter = (req, file, cb) => {
  console.log("File filter check:", {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  });

  if (file.mimetype !== "application/pdf") {
    return cb(new Error("Only PDF files are allowed"), false);
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== ".pdf") {
    return cb(new Error("File must have .pdf extension"), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
  onError: (err, next) => {
    console.error("Multer error:", err);
    next(err);
  },
});

module.exports = upload;
