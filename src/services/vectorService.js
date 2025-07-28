const axios = require("axios");

class VectorService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.embeddingModel = "models/embedding-001";
  }

  async generateEmbeddings(texts) {
    if (!this.apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const embeddings = [];
    const batchSize = 10;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.processEmbeddingBatch(batch);
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  async processEmbeddingBatch(texts) {
    try {
      const requests = texts.map((text) => ({
        model: this.embeddingModel,
        content: { parts: [{ text: text }] },
      }));

      const embeddings = [];
      for (const request of requests) {
        try {
          const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:embedContent?key=${this.apiKey}`,
            request,
            {
              headers: { "Content-Type": "application/json" },
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
            embeddings.push(new Array(768).fill(0));
          }
        } catch (error) {
          console.error(
            "Embedding generation failed for text:",
            text.substring(0, 50)
          );
          embeddings.push(new Array(768).fill(0));
        }
      }

      return embeddings;
    } catch (error) {
      console.error("Batch embedding error:", error);
      return texts.map(() => new Array(768).fill(0));
    }
  }

  async generateQueryEmbedding(query) {
    try {
      const embeddings = await this.generateEmbeddings([query]);
      return embeddings[0];
    } catch (error) {
      console.error("Query embedding error:", error);
      return new Array(768).fill(0);
    }
  }

  calculateCosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  async findSimilarChunks(chunks, queryEmbedding, limit = 5, threshold = 0.3) {
    if (!chunks || chunks.length === 0 || !queryEmbedding) {
      return [];
    }

    const similarities = chunks
      .filter((chunk) => chunk.embedding && chunk.embedding.length > 0)
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

    return similarities;
  }
}

module.exports = new VectorService();
