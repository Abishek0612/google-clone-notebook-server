const pdf = require("pdf-parse");
const fs = require("fs").promises;

class PDFService {
  async extractText(filePath) {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdf(dataBuffer, {
        max: 0,
        version: "v1.10.100",
      });

      return {
        text: data.text,
        pageCount: data.numpages,
        info: data.info,
      };
    } catch (error) {
      throw new Error(`PDF extraction failed: ${error.message}`);
    }
  }

  chunkText(text, chunkSize = 1000) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 15);

    let currentChunk = "";
    let currentPage = 1;
    let charCount = 0;

    sentences.forEach((sentence) => {
      const trimmedSentence = sentence.trim();

      if (
        currentChunk.length + trimmedSentence.length > chunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push({
          text: currentChunk.trim(),
          page: currentPage,
          startIndex: charCount - currentChunk.length,
          endIndex: charCount,
        });
        currentChunk = trimmedSentence;
      } else {
        currentChunk += (currentChunk ? ". " : "") + trimmedSentence;
      }

      charCount += trimmedSentence.length;

      if (charCount > currentPage * 1200) {
        currentPage++;
      }
    });

    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        page: currentPage,
        startIndex: charCount - currentChunk.length,
        endIndex: charCount,
      });
    }

    return chunks;
  }

  findRelevantChunks(chunks, query, maxChunks = 3) {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const scoredChunks = chunks.map((chunk) => {
      if (!chunk || !chunk.text || typeof chunk.text !== "string") {
        return { ...chunk, score: 0, text: chunk?.text || "" };
      }

      const chunkText = chunk.text.toLowerCase();
      let score = 0;

      queryWords.forEach((word) => {
        const exactMatches = (
          chunkText.match(new RegExp(`\\b${word}\\b`, "g")) || []
        ).length;
        const partialMatches = (chunkText.match(new RegExp(word, "g")) || [])
          .length;

        score += exactMatches * 3;
        score += (partialMatches - exactMatches) * 1;

        if (word.length > 4) {
          score += exactMatches * 2;
        }
      });

      return { ...chunk, score };
    });

    return scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks)
      .filter(
        (chunk) => chunk.score > 0 && chunk.text && chunk.text.length > 0
      );
  }
}

module.exports = new PDFService();
