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

      if (!data.text || data.text.trim().length === 0) {
        throw new Error("PDF contains no extractable text content");
      }

      return {
        text: data.text,
        pageCount: data.numpages,
        info: data.info,
        extractionDate: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`PDF extraction failed: ${error.message}`);
    }
  }

  chunkText(text, chunkSize = 800, overlap = 100) {
    if (!text || text.trim().length === 0) {
      throw new Error("No text provided for chunking");
    }

    const chunks = [];
    const cleanText = this.cleanText(text);
    const paragraphs = this.splitIntoParagraphs(cleanText);

    let currentChunk = "";
    let currentPage = 1;
    let totalCharacters = 0;
    let chunkStartIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const sentences = this.splitIntoSentences(paragraph);

      for (let j = 0; j < sentences.length; j++) {
        const sentence = sentences[j].trim();

        if (sentence.length < 10) continue;

        if (
          currentChunk.length + sentence.length + 2 > chunkSize &&
          currentChunk.length > 0
        ) {
          const chunkText = currentChunk.trim();
          if (chunkText.length > 0) {
            const chunk = this.createChunk(
              chunkText,
              currentPage,
              chunkStartIndex,
              totalCharacters,
              chunks.length
            );
            if (chunk) {
              chunks.push(chunk);
            }
          }

          const overlapText = this.createOverlap(currentChunk, overlap);
          currentChunk = overlapText + (overlapText ? " " : "") + sentence;
          chunkStartIndex = totalCharacters - overlapText.length;
        } else {
          currentChunk += (currentChunk ? ". " : "") + sentence;
        }

        totalCharacters += sentence.length;

        const estimatedPage = Math.ceil(totalCharacters / 2000);
        if (estimatedPage > currentPage) {
          currentPage = estimatedPage;
        }
      }
    }

    if (currentChunk.trim().length > 0) {
      const finalChunk = this.createChunk(
        currentChunk.trim(),
        currentPage,
        chunkStartIndex,
        totalCharacters,
        chunks.length
      );
      if (finalChunk) {
        chunks.push(finalChunk);
      }
    }

    const validatedChunks = chunks.filter((chunk) => {
      if (
        !chunk ||
        !chunk.text ||
        typeof chunk.text !== "string" ||
        chunk.text.trim().length === 0
      ) {
        return false;
      }
      return true;
    });

    if (validatedChunks.length === 0) {
      throw new Error("No valid chunks created from text");
    }

    return validatedChunks;
  }

  async findRelevantChunks(chunks, query, maxChunks = 5) {
    if (!chunks || chunks.length === 0) {
      throw new Error("No chunks available for search");
    }

    if (!query || query.trim().length === 0) {
      throw new Error("Query is required for chunk search");
    }

    const relevantChunks = this.findKeywordRelevantChunks(
      chunks,
      query,
      maxChunks
    );
    const validChunks = relevantChunks.filter(
      (chunk) => chunk.text && typeof chunk.text === "string"
    );

    return validChunks;
  }

  findKeywordRelevantChunks(chunks, query, maxChunks = 5) {
    const queryWords = this.extractQueryWords(query);

    if (queryWords.length === 0) {
      throw new Error("No meaningful words found in query");
    }

    const validChunks = chunks.filter(
      (chunk) => chunk.text && typeof chunk.text === "string"
    );

    if (validChunks.length === 0) {
      throw new Error("No valid text chunks available");
    }

    const scoredChunks = validChunks.map((chunk) => {
      const score = this.calculateRelevanceScore(chunk, queryWords, query);
      return {
        ...chunk,
        relevanceScore: score.total,
        scoreDetails: score.details,
        matchedKeywords: score.matchedKeywords,
      };
    });

    let relevantChunks = scoredChunks
      .filter((chunk) => chunk.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxChunks);

    if (relevantChunks.length === 0) {
      const allScores = scoredChunks
        .map((c) => c.relevanceScore)
        .sort((a, b) => b - a);
      const dynamicThreshold =
        allScores[Math.min(maxChunks - 1, allScores.length - 1)] || 0;

      relevantChunks = scoredChunks
        .filter((chunk) => chunk.relevanceScore >= dynamicThreshold)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxChunks);
    }

    if (relevantChunks.length === 0) {
      const partialMatches = scoredChunks
        .filter((chunk) => {
          const chunkTextLower = chunk.text.toLowerCase();
          return queryWords.some((word) =>
            chunkTextLower.includes(word.toLowerCase())
          );
        })
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxChunks);

      if (partialMatches.length > 0) {
        relevantChunks = partialMatches;
      }
    }

    return relevantChunks;
  }

  calculateRelevanceScore(chunk, queryWords, originalQuery) {
    if (!chunk || !chunk.text || typeof chunk.text !== "string") {
      return { total: 0, details: {}, matchedKeywords: [] };
    }

    const chunkTextLower = chunk.text.toLowerCase();
    const originalQueryLower = originalQuery.toLowerCase();

    let totalScore = 0;
    let exactMatches = 0;
    let partialMatches = 0;
    let matchedKeywords = [];

    queryWords.forEach((word) => {
      const wordLower = word.toLowerCase();

      const exactMatchRegex = new RegExp(
        `\\b${this.escapeRegex(wordLower)}\\b`,
        "g"
      );
      const exactMatchCount = (chunkTextLower.match(exactMatchRegex) || [])
        .length;

      if (exactMatchCount > 0) {
        exactMatches += exactMatchCount;
        matchedKeywords.push(word);
        let wordScore = exactMatchCount * 10;

        if (word.length > 3) {
          wordScore *= 1.5;
        }

        if (word.length > 6) {
          wordScore *= 2;
        }

        totalScore += wordScore;
      }

      const partialMatchCount = (
        chunkTextLower.match(new RegExp(this.escapeRegex(wordLower), "g")) || []
      ).length;
      const additionalPartialMatches = Math.max(
        0,
        partialMatchCount - exactMatchCount
      );

      if (additionalPartialMatches > 0) {
        partialMatches += additionalPartialMatches;
        totalScore += additionalPartialMatches * 3;
      }

      if (chunkTextLower.includes(wordLower)) {
        totalScore += 2;
      }
    });

    if (matchedKeywords.length > 1) {
      totalScore *= 1 + matchedKeywords.length * 0.3;
    }

    if (
      originalQueryLower.length > 3 &&
      chunkTextLower.includes(originalQueryLower)
    ) {
      totalScore *= 3;
    }

    const normalizedScore = totalScore / Math.sqrt(chunk.text.length / 100);

    return {
      total: normalizedScore,
      details: {
        exactMatches,
        partialMatches,
        uniqueWords: matchedKeywords.length,
        chunkLength: chunk.text.length,
      },
      matchedKeywords,
    };
  }

  extractQueryWords(query) {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .filter((word, index, array) => array.indexOf(word) === index);
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  cleanText(text) {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .replace(/^\s+|\s+$/gm, "")
      .trim();
  }

  splitIntoParagraphs(text) {
    return text
      .split(/\n\s*\n/)
      .filter((para) => para.trim().length > 0)
      .map((para) => para.replace(/\n/g, " ").trim());
  }

  splitIntoSentences(paragraph) {
    return paragraph
      .split(/[.!?]+/)
      .filter((sentence) => sentence.trim().length > 0)
      .map((sentence) => sentence.trim());
  }

  createOverlap(currentChunk, overlapSize) {
    if (!currentChunk || overlapSize <= 0) return "";

    const words = currentChunk.split(" ");
    const overlapWords = Math.min(
      Math.floor(overlapSize / 10),
      words.length,
      15
    );

    return words.slice(-overlapWords).join(" ");
  }

  createChunk(text, page, startIndex, endIndex, chunkIndex) {
    const chunkText = text && typeof text === "string" ? text.trim() : "";

    if (chunkText.length === 0) {
      return null;
    }

    const words = chunkText.split(" ");
    const sentences = chunkText
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);

    return {
      text: chunkText,
      page: page || 1,
      startIndex: startIndex || 0,
      endIndex: endIndex || chunkText.length,
      chunkIndex: chunkIndex || 0,
      wordCount: words.length,
      sentenceCount: sentences.length,
      characterCount: chunkText.length,
      createdAt: new Date().toISOString(),
    };
  }

  getStatistics(chunks) {
    if (!chunks || chunks.length === 0) {
      return {
        totalChunks: 0,
        totalCharacters: 0,
        totalWords: 0,
        averageChunkSize: 0,
      };
    }

    const validChunks = chunks.filter(
      (chunk) => chunk.text && typeof chunk.text === "string"
    );

    const totalCharacters = validChunks.reduce(
      (sum, chunk) => sum + (chunk.characterCount || chunk.text.length || 0),
      0
    );
    const totalWords = validChunks.reduce(
      (sum, chunk) =>
        sum + (chunk.wordCount || chunk.text.split(" ").length || 0),
      0
    );

    return {
      totalChunks: validChunks.length,
      totalCharacters: totalCharacters,
      totalWords: totalWords,
      averageChunkSize:
        validChunks.length > 0
          ? Math.round(totalCharacters / validChunks.length)
          : 0,
      averageWordsPerChunk:
        validChunks.length > 0
          ? Math.round(totalWords / validChunks.length)
          : 0,
      sizeRange:
        validChunks.length > 0
          ? {
              min: Math.min(
                ...validChunks.map(
                  (c) => c.characterCount || c.text.length || 0
                )
              ),
              max: Math.max(
                ...validChunks.map(
                  (c) => c.characterCount || c.text.length || 0
                )
              ),
            }
          : { min: 0, max: 0 },
    };
  }
}

module.exports = new PDFService();
