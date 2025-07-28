const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
  pdfId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PDF",
    required: true,
    index: true,
  },
  messages: [
    {
      role: {
        type: String,
        enum: ["user", "assistant"],
        required: true,
      },
      content: {
        type: String,
        required: true,
      },
      citations: [
        {
          page: Number,
          text: String,
        },
      ],
      relevanceScore: {
        type: Number,
        min: 0,
        max: 1,
      },
      sourceChunks: [
        {
          page: Number,
          content: String,
          similarity: Number,
        },
      ],
      searchMethod: {
        type: String,
        enum: ["vector", "keyword"],
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

conversationSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

conversationSchema.index({ pdfId: 1, createdAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
