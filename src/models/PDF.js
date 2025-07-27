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
    },
  ],
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

pdfSchema.index({ content: "text" });

module.exports = mongoose.model("PDF", pdfSchema);
