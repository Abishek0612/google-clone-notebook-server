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

      const contextText = this.prepareContext(relevantChunks, context);

      if (!contextText || contextText.trim().length === 0) {
        throw new Error("No content available to analyze");
      }

      const response = await this.callGeminiAPI(question, contextText);
      const citations = this.extractCitations(relevantChunks);

      return {
        answer: response,
        citations: citations,
      };
    } catch (error) {
      throw new Error(`AI Service failed: ${error.message}`);
    }
  }

  prepareContext(relevantChunks, fullContext) {
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

      if (validChunks.length === 0) {
        contextText = fullContext || "";
      } else {
        contextText = validChunks
          .map((chunkData) => chunkData.text.trim())
          .join("\n\n");
      }
    } else if (fullContext && typeof fullContext === "string") {
      contextText = fullContext;
    } else {
      throw new Error("No context available");
    }

    if (!contextText || contextText.trim().length === 0) {
      throw new Error("Prepared context is empty");
    }

    const maxContextLength = 25000;

    if (contextText.length > maxContextLength) {
      const firstPart = contextText.substring(
        0,
        Math.floor(maxContextLength * 0.7)
      );
      const lastPart = contextText.substring(
        contextText.length - Math.floor(maxContextLength * 0.3)
      );
      contextText =
        firstPart + "\n\n[... content truncated ...]\n\n" + lastPart;
    }

    return contextText;
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

  async callGeminiAPI(question, context) {
    if (!this.geminiApiKey || !this.geminiApiKey.startsWith("AIza")) {
      throw new Error("Invalid Gemini API key");
    }

    const prompt = this.buildPrompt(question, context);

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
        temperature: 0.2,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 2048,
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

    const modelsToTry = [
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro",
      "models/gemini-1.5-flash",
      "models/gemini-1.5-pro",
    ];

    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.geminiApiKey}`,
          requestBody,
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: 60000,
          }
        );

        if (!response.data) {
          throw new Error("Empty response from Gemini API");
        }

        if (
          !response.data.candidates ||
          response.data.candidates.length === 0
        ) {
          if (response.data.promptFeedback) {
            const feedback = response.data.promptFeedback;
            if (feedback.blockReason) {
              throw new Error(
                `Gemini API blocked request: ${feedback.blockReason}`
              );
            }
          }
          throw new Error("No candidates in Gemini API response");
        }

        const candidate = response.data.candidates[0];

        if (candidate.finishReason === "SAFETY") {
          throw new Error("Response blocked by Gemini safety filters");
        }

        if (candidate.finishReason === "RECITATION") {
          throw new Error("Response blocked due to recitation concerns");
        }

        if (
          !candidate.content ||
          !candidate.content.parts ||
          candidate.content.parts.length === 0
        ) {
          throw new Error("Invalid content structure in Gemini API response");
        }

        const generatedText = candidate.content.parts[0].text;

        if (!generatedText || generatedText.trim().length === 0) {
          throw new Error("Empty text generated by Gemini API");
        }

        return generatedText.trim();
      } catch (error) {
        lastError = error;

        if (error.response && error.response.status === 404) {
          continue;
        }
        break;
      }
    }

    if (lastError.response) {
      if (lastError.response.status === 400) {
        const errorData = lastError.response.data;
        if (errorData.error && errorData.error.message) {
          throw new Error(`Gemini API Bad Request: ${errorData.error.message}`);
        } else {
          throw new Error(
            `Gemini API Bad Request: ${JSON.stringify(errorData)}`
          );
        }
      } else if (lastError.response.status === 403) {
        throw new Error("Gemini API access denied");
      } else if (lastError.response.status === 429) {
        throw new Error("Gemini API rate limit exceeded");
      } else {
        throw new Error(
          `Gemini API error (${lastError.response.status}): ${lastError.response.statusText}`
        );
      }
    } else {
      throw new Error(`All Gemini models failed: ${lastError.message}`);
    }
  }

  buildPrompt(question, context) {
    if (!question || typeof question !== "string") {
      throw new Error("Invalid question provided");
    }

    if (!context || typeof context !== "string") {
      throw new Error("Invalid context provided");
    }

    return `You are a helpful AI assistant that analyzes documents and answers questions based on the provided content.

DOCUMENT CONTENT:
${context}

QUESTION: ${question}

INSTRUCTIONS:
- Answer the question based ONLY on the information provided in the document content above
- Be specific, accurate, and detailed in your response
- If the exact information is not available in the document, clearly state that
- Quote relevant parts from the document when appropriate
- Maintain a professional and helpful tone
- Do not make assumptions or add information not present in the document

ANSWER:`;
  }

  extractCitations(relevantChunks) {
    if (
      !relevantChunks ||
      !Array.isArray(relevantChunks) ||
      relevantChunks.length === 0
    ) {
      return [
        {
          page: 1,
          text: "Document content...",
        },
      ];
    }

    return relevantChunks
      .map((chunk) => this.extractChunkData(chunk))
      .filter((chunkData) => chunkData && chunkData.text)
      .map((chunkData) => ({
        page: chunkData.page || 1,
        text:
          chunkData.text.length > 120
            ? chunkData.text.substring(0, 120) + "..."
            : chunkData.text,
      }));
  }

  async testConnection() {
    try {
      const testResponse = await this.callGeminiAPI(
        "What is artificial intelligence?",
        "Artificial intelligence (AI) is a branch of computer science that aims to create intelligent machines that can perform tasks that typically require human intelligence."
      );

      return {
        success: true,
        message: "Gemini API is working correctly",
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
