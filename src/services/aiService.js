const axios = require("axios");

class AIService {
  constructor() {
    this.provider = process.env.AI_PROVIDER || "gemini";
    this.geminiApiKey = process.env.GEMINI_API_KEY;

    if (!this.geminiApiKey) {
      throw new Error("GEMINI_API_KEY not found in environment variables");
    }
  }

  async generateResponse(context, question, relevantChunks) {
    try {
      if (!question || question.trim().length === 0) {
        throw new Error("Question cannot be empty");
      }

      if (!this.geminiApiKey) {
        throw new Error("Gemini API key not configured");
      }

      const contextText = this.prepareContext(
        relevantChunks,
        context,
        question
      );

      if (!contextText || contextText.trim().length === 0) {
        throw new Error("No content available to analyze");
      }

      const response = await this.callGeminiAPIWithRetry(question, contextText);
      const citations = this.extractCitations(relevantChunks);

      return {
        answer: response,
        citations: citations,
      };
    } catch (error) {
      throw new Error(`AI Service failed: ${error.message}`);
    }
  }

  prepareContext(relevantChunks, fullContext, question) {
    let contextText = "";

    if (
      relevantChunks &&
      Array.isArray(relevantChunks) &&
      relevantChunks.length > 0
    ) {
      const validChunks = relevantChunks
        .map((chunk) => this.extractChunkData(chunk))
        .filter((chunkData) => {
          return (
            chunkData &&
            chunkData.text &&
            typeof chunkData.text === "string" &&
            chunkData.text.trim().length > 0
          );
        });

      if (validChunks.length > 0) {
        contextText = validChunks
          .map((chunkData) => chunkData.text.trim())
          .join("\n\n");
      } else if (fullContext && typeof fullContext === "string") {
        contextText = this.smartContextExtraction(fullContext, question);
      } else {
        throw new Error("No valid content found in chunks or full context");
      }
    } else if (fullContext && typeof fullContext === "string") {
      contextText = this.smartContextExtraction(fullContext, question);
    } else {
      throw new Error(
        "No context available - neither chunks nor full context provided"
      );
    }

    if (!contextText || contextText.trim().length === 0) {
      throw new Error("Prepared context is empty after processing");
    }

    return contextText;
  }

  smartContextExtraction(fullContext, question) {
    const questionWords = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const contextLength = fullContext.length;

    if (contextLength <= 8000) {
      return fullContext;
    }

    const sections = this.findRelevantSections(fullContext, questionWords);

    if (sections.length > 0) {
      const combinedSections = sections.join("\n\n");
      if (combinedSections.length <= 8000) {
        return combinedSections;
      }
    }

    const chunkSize = Math.floor(8000 / 3);
    const start = fullContext.substring(0, chunkSize);
    const middle = this.findBestMiddleSection(
      fullContext,
      questionWords,
      chunkSize
    );
    const end = fullContext.substring(contextLength - chunkSize);

    return start + "\n\n" + middle + "\n\n" + end;
  }

  findRelevantSections(text, questionWords) {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const scoredSentences = sentences.map((sentence) => {
      const sentenceLower = sentence.toLowerCase();
      const score = questionWords.reduce((acc, word) => {
        return acc + (sentenceLower.includes(word) ? word.length : 0);
      }, 0);
      return { sentence: sentence.trim(), score };
    });

    return scoredSentences
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((item) => item.sentence);
  }

  findBestMiddleSection(text, questionWords, maxLength) {
    const middleStart = Math.floor(text.length * 0.3);
    const middleEnd = Math.floor(text.length * 0.7);
    const middleSection = text.substring(middleStart, middleEnd);

    const sentences = middleSection
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 20);
    const scoredSentences = sentences.map((sentence) => {
      const sentenceLower = sentence.toLowerCase();
      const score = questionWords.reduce((acc, word) => {
        return acc + (sentenceLower.includes(word) ? word.length * 2 : 0);
      }, 0);
      return { sentence: sentence.trim(), score };
    });

    let selectedSentences = [];
    let currentLength = 0;

    for (const item of scoredSentences.sort((a, b) => b.score - a.score)) {
      if (currentLength + item.sentence.length <= maxLength) {
        selectedSentences.push(item.sentence);
        currentLength += item.sentence.length;
      }
    }

    return selectedSentences.length > 0
      ? selectedSentences.join(". ")
      : middleSection.substring(0, maxLength);
  }

  extractChunkData(chunk) {
    if (!chunk) {
      return null;
    }

    if (chunk._doc && typeof chunk._doc === "object") {
      return {
        text: chunk._doc.text,
        page: chunk._doc.page || 1,
        startIndex: chunk._doc.startIndex,
        endIndex: chunk._doc.endIndex,
      };
    }

    if (typeof chunk.toObject === "function") {
      const obj = chunk.toObject();
      return {
        text: obj.text,
        page: obj.page || 1,
        startIndex: obj.startIndex,
        endIndex: obj.endIndex,
      };
    }

    if (chunk.text && typeof chunk.text === "string") {
      return {
        text: chunk.text,
        page: chunk.page || 1,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
      };
    }

    if (typeof chunk === "object") {
      const possibleTextPaths = [
        chunk.text,
        chunk.content,
        chunk.data?.text,
        chunk.document?.text,
      ];

      for (const textPath of possibleTextPaths) {
        if (
          textPath &&
          typeof textPath === "string" &&
          textPath.trim().length > 0
        ) {
          return {
            text: textPath,
            page: chunk.page || chunk.data?.page || 1,
            startIndex: chunk.startIndex || chunk.data?.startIndex,
            endIndex: chunk.endIndex || chunk.data?.endIndex,
          };
        }
      }
    }

    return null;
  }

  async callGeminiAPIWithRetry(question, context) {
    const modelsToTry = [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ];

    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await this.callGeminiAPI(question, context, modelName);
        return response;
      } catch (error) {
        lastError = error;

        if (error.response?.status === 503) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        if (error.response?.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        if (error.response?.status === 400 || error.response?.status === 404) {
          continue;
        }

        break;
      }
    }

    if (lastError.response) {
      const status = lastError.response.status;
      if (status === 503) {
        throw new Error(
          "AI service is temporarily unavailable. Please try again in a few moments."
        );
      } else if (status === 429) {
        throw new Error(
          "AI service rate limit exceeded. Please wait a moment and try again."
        );
      } else if (status === 413) {
        throw new Error(
          "Document is too large to process. Please try with a smaller document."
        );
      } else if (status === 400) {
        const errorData = lastError.response.data;
        throw new Error(
          `Invalid request: ${
            errorData.error?.message || "Please try rephrasing your question"
          }`
        );
      } else if (status === 403) {
        throw new Error(
          "AI service access denied. Please check your API configuration."
        );
      } else if (status === 404) {
        throw new Error(
          "The AI models are currently unavailable. This may be due to API changes or regional restrictions."
        );
      } else {
        throw new Error(
          `AI service error (${status}). Please try again later.`
        );
      }
    } else {
      throw new Error(
        "AI service connection failed. Please check your internet connection and try again."
      );
    }
  }

  async callGeminiAPI(question, context, modelName) {
    if (!this.geminiApiKey || !this.geminiApiKey.startsWith("AIza")) {
      throw new Error("Invalid Gemini API key configuration");
    }

    const prompt = `Document content:\n${context}\n\nQuestion: ${question}\n\nAnswer based only on the document:`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 16,
        topP: 0.9,
        maxOutputTokens: 1024,
        candidateCount: 1,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    };

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.geminiApiKey}`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    if (
      !response.data ||
      !response.data.candidates ||
      response.data.candidates.length === 0
    ) {
      if (response.data.promptFeedback) {
        const feedback = response.data.promptFeedback;
        if (feedback.blockReason) {
          throw new Error(`Request blocked: ${feedback.blockReason}`);
        }
      }
      throw new Error("No valid response generated by AI model");
    }

    const candidate = response.data.candidates[0];

    if (candidate.finishReason === "SAFETY") {
      throw new Error("Response blocked by safety filters");
    }

    if (candidate.finishReason === "RECITATION") {
      throw new Error("Response blocked due to recitation concerns");
    }

    if (
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0
    ) {
      throw new Error("Invalid response structure from AI model");
    }

    const generatedText = candidate.content.parts[0].text;

    if (!generatedText || generatedText.trim().length === 0) {
      throw new Error("Empty response generated by AI model");
    }

    return generatedText.trim();
  }

  extractCitations(relevantChunks) {
    if (
      !relevantChunks ||
      !Array.isArray(relevantChunks) ||
      relevantChunks.length === 0
    ) {
      return [];
    }

    return relevantChunks
      .map((chunk) => this.extractChunkData(chunk))
      .filter((chunkData) => chunkData && chunkData.text)
      .map((chunkData) => ({
        page: chunkData.page || 1,
        text:
          chunkData.text.length > 150
            ? chunkData.text.substring(0, 150) + "..."
            : chunkData.text,
      }));
  }

  async testConnection() {
    try {
      const testResponse = await this.callGeminiAPIWithRetry(
        "What is the main topic of this document?",
        "This is a test document about artificial intelligence and machine learning technologies."
      );

      return {
        success: true,
        message: "API connection successful",
        response: testResponse,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        response: null,
      };
    }
  }

  validateApiKey() {
    if (!this.geminiApiKey) {
      return {
        valid: false,
        message: "API key not provided",
      };
    }

    if (!this.geminiApiKey.startsWith("AIza")) {
      return {
        valid: false,
        message: "API key format invalid",
      };
    }

    if (this.geminiApiKey.length < 35) {
      return {
        valid: false,
        message: "API key too short",
      };
    }

    return {
      valid: true,
      message: "API key format appears valid",
    };
  }

  getStatus() {
    const keyValidation = this.validateApiKey();

    return {
      provider: this.provider,
      apiKeyConfigured: !!this.geminiApiKey,
      apiKeyValid: keyValidation.valid,
      apiKeyMessage: keyValidation.message,
      ready: keyValidation.valid,
    };
  }
}

module.exports = new AIService();
