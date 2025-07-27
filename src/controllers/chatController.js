const Conversation = require("../models/Conversation");
const PDF = require("../models/PDF");
const aiService = require("../services/aiService");
const pdfService = require("../services/pdfService");

exports.sendMessage = async (req, res) => {
  try {
    const { pdfId, message } = req.body;
    console.log("=== Chat Controller Debug ===");
    console.log("PDF ID:", pdfId);
    console.log("Message:", message);

    if (!pdfId || !message) {
      return res.status(400).json({ error: "PDF ID and message are required" });
    }

    const pdf = await PDF.findById(pdfId);
    if (!pdf) {
      console.log("PDF not found in database");
      return res.status(404).json({ error: "PDF not found" });
    }

    console.log("Found PDF:", pdf.originalName);
    console.log("PDF content length:", pdf.content ? pdf.content.length : 0);
    console.log("PDF chunks count:", pdf.chunks ? pdf.chunks.length : 0);
    console.log(
      "PDF content preview:",
      pdf.content ? pdf.content.substring(0, 200) : "No content"
    );

    const relevantChunks = pdfService.findRelevantChunks(pdf.chunks, message);
    console.log("Relevant chunks found:", relevantChunks.length);

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

    conversation.messages.push({
      role: "assistant",
      content: aiResponse.answer,
      citations: aiResponse.citations,
    });

    await conversation.save();

    res.json({
      response: aiResponse.answer,
      citations: aiResponse.citations,
      conversationId: conversation._id,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process message" });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const { pdfId } = req.params;

    const conversation = await Conversation.findOne({ pdfId }).populate(
      "pdfId",
      "originalName"
    );

    if (!conversation) {
      return res.json({ messages: [] });
    }

    res.json({
      messages: conversation.messages,
      pdfName: conversation.pdfId.originalName,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
};
