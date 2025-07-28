const Conversation = require("../models/Conversation");
const PDF = require("../models/PDF");
const aiService = require("../services/aiService");
const vectorService = require("../services/vectorService");

exports.sendMessage = async (req, res) => {
  try {
    const { pdfId, message } = req.body;

    if (!pdfId || !message) {
      return res.status(400).json({ error: "PDF ID and message are required" });
    }

    console.log(`Processing message for PDF ${pdfId}: ${message}`);

    const pdf = await PDF.findById(pdfId);
    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    let relevantChunks = [];
    let useVectorSearch = pdf.embeddingStatus === "completed";

    if (useVectorSearch) {
      const queryEmbedding = await vectorService.generateQueryEmbedding(
        message
      );
      relevantChunks = await vectorService.findSimilarChunks(
        pdf.chunks,
        queryEmbedding,
        5,
        0.3
      );
      console.log(
        `Found ${relevantChunks.length} relevant chunks using vector search`
      );
    } else {
      const pdfService = require("../services/pdfService");
      relevantChunks = await pdfService.findRelevantChunks(pdf.chunks, message);
      console.log(
        `Found ${relevantChunks.length} relevant chunks using keyword search`
      );
    }

    let conversation = await Conversation.findOne({ pdfId });
    if (!conversation) {
      conversation = new Conversation({ pdfId, messages: [] });
    }

    conversation.messages.push({
      role: "user",
      content: message,
    });

    const aiResponse = await aiService.generateResponse(
      pdf.content,
      message,
      relevantChunks
    );

    console.log(`AI Response: ${aiResponse.answer.substring(0, 100)}...`);

    const responseMessage = {
      role: "assistant",
      content: aiResponse.answer,
      citations: aiResponse.citations,
    };

    if (useVectorSearch && relevantChunks.length > 0) {
      responseMessage.relevanceScore = relevantChunks[0].similarity;
      responseMessage.sourceChunks = relevantChunks
        .slice(0, 3)
        .map((chunk) => ({
          page: chunk.page,
          content: chunk.text.substring(0, 200),
          similarity: chunk.similarity,
        }));
    }

    conversation.messages.push(responseMessage);
    await conversation.save();

    res.json({
      response: aiResponse.answer,
      citations: aiResponse.citations,
      conversationId: conversation._id,
      searchMethod: useVectorSearch ? "vector" : "keyword",
      relevanceScore: responseMessage.relevanceScore,
      sourceChunks: responseMessage.sourceChunks,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Failed to process message",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const { pdfId } = req.params;

    const conversation = await Conversation.findOne({ pdfId }).populate(
      "pdfId",
      "originalName embeddingStatus"
    );

    if (!conversation) {
      return res.json({ messages: [] });
    }

    res.json({
      messages: conversation.messages,
      pdfName: conversation.pdfId.originalName,
      embeddingStatus: conversation.pdfId.embeddingStatus,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
};

exports.searchSimilar = async (req, res) => {
  try {
    const { pdfId, query, limit = 5 } = req.body;

    const pdf = await PDF.findById(pdfId);
    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    if (pdf.embeddingStatus !== "completed") {
      return res.status(400).json({ error: "Embeddings not ready" });
    }

    const queryEmbedding = await vectorService.generateQueryEmbedding(query);
    const similarChunks = await vectorService.findSimilarChunks(
      pdf.chunks,
      queryEmbedding,
      limit,
      0.2
    );

    res.json({
      results: similarChunks.map((chunk) => ({
        text: chunk.text,
        page: chunk.page,
        similarity: chunk.similarity,
      })),
    });
  } catch (error) {
    console.error("Search similar error:", error);
    res.status(500).json({ error: "Failed to search similar content" });
  }
};
