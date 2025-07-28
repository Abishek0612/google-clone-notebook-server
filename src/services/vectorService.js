const axios = require("axios");

class VectorService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.embeddingModel = "text-embedding-004";
  }

  async generateEmbeddings(texts) {
    if (!this.apiKey) {
      throw new Error("Gemini API key not configured");
    }

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      throw new Error("Invalid texts provided for embedding generation");
    }

    const embeddings = [];
    const batchSize = 3;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      try {
        const batchEmbeddings = await this.processEmbeddingBatch(batch);
        embeddings.push(...batchEmbeddings);

        if (i + batchSize < texts.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(
          `Failed to process embedding batch ${i}-${i + batch.length}:`,
          error
        );
        throw new Error(
          `Embedding generation failed for batch starting at index ${i}: ${error.message}`
        );
      }
    }

    return embeddings;
  }

  async processEmbeddingBatch(texts) {
    if (!texts || texts.length === 0) {
      throw new Error("Empty text batch provided");
    }

    const embeddings = [];

    for (const text of texts) {
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        throw new Error("Invalid text content in batch");
      }

      try {
        const cleanText = text.trim().substring(0, 2048);

        const requestBody = {
          model: `models/${this.embeddingModel}`,
          content: {
            parts: [{ text: cleanText }],
          },
        };

        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:embedContent?key=${this.apiKey}`,
          requestBody,
          {
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "NotebookLM-Clone/1.0",
            },
            timeout: 30000,
          }
        );

        if (
          response.data &&
          response.data.embedding &&
          response.data.embedding.values
        ) {
          embeddings.push(response.data.embedding.values);
        } else {
          throw new Error("Invalid embedding response structure");
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error("Individual embedding generation failed:", error.message);

        if (error.response?.status === 404) {
          throw new Error(
            "Embedding model not found. Please check API configuration."
          );
        } else if (error.response?.status === 403) {
          throw new Error("API access denied. Please check your API key.");
        } else if (error.response?.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          throw new Error("Rate limit exceeded. Please try again later.");
        } else {
          throw new Error(`Failed to generate embedding: ${error.message}`);
        }
      }
    }

    return embeddings;
  }

  async generateQueryEmbedding(query) {
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new Error("Invalid query provided for embedding");
    }

    try {
      const embeddings = await this.generateEmbeddings([query]);
      return embeddings[0];
    } catch (error) {
      console.error("Query embedding error:", error);
      throw new Error(`Failed to generate query embedding: ${error.message}`);
    }
  }

  calculateCosineSimilarity(a, b) {
    if (
      !a ||
      !b ||
      !Array.isArray(a) ||
      !Array.isArray(b) ||
      a.length !== b.length
    ) {
      return 0;
    }

    if (a.length === 0 || b.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const valA = parseFloat(a[i]) || 0;
      const valB = parseFloat(b[i]) || 0;

      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return Math.max(0, Math.min(1, dotProduct / (normA * normB)));
  }

  async findSimilarChunks(chunks, queryEmbedding, limit = 5, threshold = 0.3) {
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      throw new Error("No chunks provided for similarity search");
    }

    if (
      !queryEmbedding ||
      !Array.isArray(queryEmbedding) ||
      queryEmbedding.length === 0
    ) {
      throw new Error("Invalid or empty query embedding provided");
    }

    const validChunks = chunks.filter((chunk) => {
      return (
        chunk &&
        chunk.embedding &&
        Array.isArray(chunk.embedding) &&
        chunk.embedding.length > 0
      );
    });

    if (validChunks.length === 0) {
      throw new Error("No chunks with valid embeddings found");
    }

    const similarities = validChunks
      .map((chunk) => ({
        ...chunk,
        similarity: this.calculateCosineSimilarity(
          chunk.embedding,
          queryEmbedding
        ),
      }))
      .filter((chunk) => chunk.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    if (similarities.length === 0) {
      throw new Error(
        `No chunks found above similarity threshold of ${threshold}`
      );
    }

    return similarities;
  }

  validateEmbedding(embedding) {
    if (!embedding || !Array.isArray(embedding)) {
      return false;
    }

    if (embedding.length === 0) {
      return false;
    }

    return embedding.every((val) => typeof val === "number" && !isNaN(val));
  }

  getEmbeddingStats(embeddings) {
    if (!embeddings || !Array.isArray(embeddings)) {
      return null;
    }

    const validEmbeddings = embeddings.filter((emb) =>
      this.validateEmbedding(emb)
    );

    return {
      total: embeddings.length,
      valid: validEmbeddings.length,
      invalid: embeddings.length - validEmbeddings.length,
      dimensionality:
        validEmbeddings.length > 0 ? validEmbeddings[0].length : 0,
    };
  }
}

module.exports = new VectorService();
