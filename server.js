const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();

app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "development" ? 1000 : 100,
  message: "Too many requests from this IP, please try again later.",
  trustProxy: true,
  skip: (req) => {
    return (
      req.path === "/health" ||
      req.path === "/" ||
      req.path.startsWith("/api/pdfs") ||
      req.path.startsWith("/api/pdf/") ||
      req.path.startsWith("/api/conversation/") ||
      process.env.NODE_ENV === "development"
    );
  },
});

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://google-notebook-llm.netlify.app",
    "https://*.netlify.app",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};

app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/pdf/") &&
    req.method === "GET" &&
    req.path.match(/^\/api\/pdf\/[a-fA-F0-9]{24}$/)
  ) {
    next();
  } else {
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    })(req, res, next);
  }
});

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  }
  next();
});

app.use(limiter);

app.get("/", (req, res) => {
  res.status(200).json({
    message: "NotebookLM Clone Backend API is running!",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

try {
  const pdfRoutes = require("./src/routes/pdf");
  const chatRoutes = require("./src/routes/chat");

  app.use("/api", pdfRoutes);
  app.use("/api", chatRoutes);

  console.log(" Routes loaded successfully");
} catch (error) {
  console.error(" Error loading routes:", error.message);
  app.use("/api/*", (req, res) => {
    res.status(500).json({
      error: "Routes not properly configured",
      message: error.message,
      path: req.path,
    });
  });
}

app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
  });
});

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is not set");
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(` Connected to MongoDB: ${conn.connection.host}`);
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(` Server running on port ${PORT}`);
    console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(` MongoDB: Connected`);
  });
};

startServer();

module.exports = app;
