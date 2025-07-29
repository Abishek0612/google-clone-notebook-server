const mongoose = require("mongoose");

const pdfSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  path: {
    type: String,
    required: true,
  },
  cloudinaryUrl: {
    type: String,
  },
  isCloudinary: {
    type: Boolean,
    default: false,
  },
  size: {
    type: Number,
    required: true,
  },
  pageCount: {
    type: Number,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  chunks: [
    {
      text: String,
      page: Number,
      startIndex: Number,
      endIndex: Number,
      embedding: [Number],
      embeddingModel: String,
      createdAt: { type: Date, default: Date.now },
    },
  ],
  embeddingStatus: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },
  embeddingProgress: {
    type: Number,
    default: 0,
  },
  embeddingError: {
    type: String,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

pdfSchema.index({ content: "text" });
pdfSchema.index({ uploadedAt: -1 });
pdfSchema.index({ embeddingStatus: 1 });

module.exports = mongoose.model("PDF", pdfSchema);
