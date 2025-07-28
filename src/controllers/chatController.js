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

    console.log("PDF found:", {
      id: pdf._id,
      name: pdf.originalName,
      contentLength: pdf.content?.length || 0,
      chunksCount: pdf.chunks?.length || 0,
      embeddingStatus: pdf.embeddingStatus,
    });

    let relevantChunks = [];
    let useVectorSearch = pdf.embeddingStatus === "completed";
    let searchMethod = "full-document";

    if (useVectorSearch) {
      try {
        console.log("Attempting vector search...");
        const queryEmbedding = await vectorService.generateQueryEmbedding(
          message
        );

        if (queryEmbedding && queryEmbedding.length > 0) {
          relevantChunks = await vectorService.findSimilarChunks(
            pdf.chunks,
            queryEmbedding,
            5,
            0.3
          );
          console.log(
            `Found ${relevantChunks.length} relevant chunks using vector search`
          );
          searchMethod = "vector";
        } else {
          throw new Error("Failed to generate query embedding");
        }
      } catch (vectorError) {
        console.error(
          "Vector search failed, falling back to keyword search:",
          vectorError
        );
        useVectorSearch = false;
      }
    }

    if (!useVectorSearch) {
      try {
        console.log("Using keyword search...");
        const pdfService = require("../services/pdfService");
        relevantChunks = await pdfService.findRelevantChunks(
          pdf.chunks,
          message
        );
        console.log(
          `Found ${relevantChunks.length} relevant chunks using keyword search`
        );
        searchMethod = "keyword";
      } catch (keywordError) {
        console.error(
          "Keyword search failed, using full document:",
          keywordError
        );
        relevantChunks = [];
        searchMethod = "full-document";
      }
    }

    const validChunks = relevantChunks.filter((chunk) => {
      if (!chunk) {
        console.warn("Found null/undefined chunk");
        return false;
      }
      if (!chunk.text || typeof chunk.text !== "string") {
        console.warn("Found chunk without valid text:", chunk);
        return false;
      }
      return true;
    });

    console.log("Valid chunks after filtering:", validChunks.length);
    console.log("Using search method:", searchMethod);

    let conversation = await Conversation.findOne({ pdfId });
    if (!conversation) {
      conversation = new Conversation({ pdfId, messages: [] });
    }

    const userMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
    };

    conversation.messages.push(userMessage);

    console.log("Calling AI service with:", {
      contentLength: pdf.content?.length || 0,
      messageLength: message.length,
      validChunksCount: validChunks.length,
      searchMethod,
    });

    const aiResponse = await aiService.generateResponse(
      pdf.content,
      message,
      validChunks
    );

    console.log(
      `AI Response generated: ${aiResponse.answer.substring(0, 100)}...`
    );

    const assistantMessage = {
      role: "assistant",
      content: aiResponse.answer,
      citations: aiResponse.citations || [],
      timestamp: new Date(),
      searchMethod: searchMethod,
    };

    if (validChunks.length > 0) {
      try {
        if (searchMethod === "vector") {
          assistantMessage.relevanceScore = validChunks[0].similarity || 0;
        }

        assistantMessage.sourceChunks = validChunks
          .slice(0, 3)
          .map((chunk) => {
            const chunkText = chunk.text || chunk.content || "";
            const chunkPage = chunk.page || 1;
            const chunkSimilarity =
              chunk.similarity || chunk.relevanceScore || 0;

            return {
              page: chunkPage,
              content:
                chunkText.length > 200
                  ? chunkText.substring(0, 200) + "..."
                  : chunkText,
              similarity: chunkSimilarity,
            };
          })
          .filter((chunk) => chunk.content.length > 0);
      } catch (metadataError) {
        console.error("Error adding metadata:", metadataError);
        assistantMessage.sourceChunks = [];
      }
    }

    conversation.messages.push(assistantMessage);

    const savedConversation = await conversation.save();

    const messagesCount = savedConversation.messages.length;
    const savedUserMessage = savedConversation.messages[messagesCount - 2];
    const savedAssistantMessage = savedConversation.messages[messagesCount - 1];

    res.json({
      response: aiResponse.answer,
      citations: aiResponse.citations,
      conversationId: savedConversation._id,
      searchMethod: assistantMessage.searchMethod,
      relevanceScore: assistantMessage.relevanceScore,
      sourceChunks: assistantMessage.sourceChunks,
      userMessage: {
        _id: savedUserMessage._id,
        role: savedUserMessage.role,
        content: savedUserMessage.content,
        timestamp: savedUserMessage.timestamp,
      },
      assistantMessage: {
        _id: savedAssistantMessage._id,
        role: savedAssistantMessage.role,
        content: savedAssistantMessage.content,
        citations: savedAssistantMessage.citations,
        relevanceScore: savedAssistantMessage.relevanceScore,
        sourceChunks: savedAssistantMessage.sourceChunks,
        searchMethod: savedAssistantMessage.searchMethod,
        timestamp: savedAssistantMessage.timestamp,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    console.error("Error stack:", error.stack);

    let userFriendlyError = "An unexpected error occurred. Please try again.";
    let statusCode = 500;

    if (error.message.includes("temporarily unavailable")) {
      userFriendlyError =
        "The AI service is temporarily busy. Please wait a moment and try again.";
      statusCode = 503;
    } else if (error.message.includes("rate limit")) {
      userFriendlyError =
        "Too many requests. Please wait a moment before trying again.";
      statusCode = 429;
    } else if (error.message.includes("too large")) {
      userFriendlyError =
        "Your document is too large to process. Please try with a smaller document.";
      statusCode = 413;
    } else if (error.message.includes("API key")) {
      userFriendlyError =
        "AI service configuration error. Please contact support.";
      statusCode = 500;
    }

    res.status(statusCode).json({
      error: userFriendlyError,
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
      retryAfter: statusCode === 503 ? 30 : statusCode === 429 ? 60 : undefined,
    });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const { pdfId } = req.params;

    if (!pdfId || pdfId === "undefined") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

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

exports.deleteMessage = async (req, res) => {
  try {
    const { pdfId, messageId } = req.params;

    console.log(
      `Delete message request - PDF: ${pdfId}, Message: ${messageId}`
    );

    if (!pdfId || pdfId === "undefined") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    if (!messageId || messageId === "undefined") {
      return res.status(400).json({ error: "Valid message ID is required" });
    }

    if (messageId.startsWith("temp-")) {
      console.log("Received temporary message ID, cannot delete:", messageId);
      return res.status(400).json({
        error: "Cannot delete message with temporary ID",
        details: "Please refresh the page and try again",
      });
    }

    const conversation = await Conversation.findOne({ pdfId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    console.log(
      `Found conversation with ${conversation.messages.length} messages`
    );

    const messageIndex = conversation.messages.findIndex(
      (msg) => msg._id.toString() === messageId
    );

    if (messageIndex === -1) {
      console.log("Message not found in conversation:", messageId);
      console.log(
        "Available message IDs:",
        conversation.messages.map((m) => m._id.toString())
      );
      return res.status(404).json({ error: "Message not found" });
    }

    console.log(`Found message at index ${messageIndex}, deleting...`);

    conversation.messages.splice(messageIndex, 1);
    await conversation.save();

    console.log(
      `Message deleted successfully. Remaining messages: ${conversation.messages.length}`
    );

    res.json({
      message: "Message deleted successfully",
      remainingMessages: conversation.messages.length,
    });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
};

exports.clearConversation = async (req, res) => {
  try {
    const { pdfId } = req.params;

    if (!pdfId || pdfId === "undefined") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    const conversation = await Conversation.findOne({ pdfId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    conversation.messages = [];
    await conversation.save();

    res.json({ message: "Conversation cleared successfully" });
  } catch (error) {
    console.error("Clear conversation error:", error);
    res.status(500).json({ error: "Failed to clear conversation" });
  }
};

exports.searchSimilar = async (req, res) => {
  try {
    const { pdfId, query, limit = 5 } = req.body;

    if (!pdfId || pdfId === "undefined") {
      return res.status(400).json({ error: "Valid PDF ID is required" });
    }

    const pdf = await PDF.findById(pdfId);
    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    if (pdf.embeddingStatus !== "completed") {
      return res.status(400).json({ error: "Embeddings not ready" });
    }

    const queryEmbedding = await vectorService.generateQueryEmbedding(query);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return res
        .status(400)
        .json({ error: "Failed to generate query embedding" });
    }

    const similarChunks = await vectorService.findSimilarChunks(
      pdf.chunks,
      queryEmbedding,
      limit,
      0.2
    );

    res.json({
      results: similarChunks
        .filter((chunk) => chunk.text && typeof chunk.text === "string")
        .map((chunk) => ({
          text: chunk.text,
          page: chunk.page || 1,
          similarity: chunk.similarity || 0,
        })),
    });
  } catch (error) {
    console.error("Search similar error:", error);
    res.status(500).json({ error: "Failed to search similar content" });
  }
};
