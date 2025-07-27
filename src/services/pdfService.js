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
      return [];
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
          const chunk = this.createChunk(
            currentChunk.trim(),
            currentPage,
            chunkStartIndex,
            totalCharacters,
            chunks.length
          );

          chunks.push(chunk);

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
      chunks.push(finalChunk);
    }

    return chunks;
  }

  async findRelevantChunks(chunks, query, maxChunks = 5) {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    if (!query || query.trim().length === 0) {
      return chunks.slice(0, Math.min(maxChunks, 3));
    }

    try {
      const aiService = require("./aiService");
      if (
        aiService &&
        typeof aiService.findSemanticallySimilarChunks === "function"
      ) {
        const semanticChunks = await aiService.findSemanticallySimilarChunks(
          chunks,
          query,
          maxChunks
        );

        if (semanticChunks && semanticChunks.length > 0) {
          return semanticChunks;
        }
      }
    } catch (error) {}

    return this.findKeywordRelevantChunks(chunks, query, maxChunks);
  }

  findKeywordRelevantChunks(chunks, query, maxChunks = 5) {
    const queryKeywords = this.extractKeywords(query);

    if (queryKeywords.length === 0) {
      return chunks.slice(0, Math.min(maxChunks, 3));
    }

    const scoredChunks = chunks.map((chunk, index) => {
      const score = this.calculateRelevanceScore(chunk, queryKeywords, query);

      return {
        ...chunk,
        relevanceScore: score.total,
        scoreDetails: score.details,
        matchedKeywords: score.matchedKeywords,
      };
    });

    const relevantChunks = scoredChunks
      .filter((chunk) => chunk.relevanceScore > 0.1)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxChunks);

    if (relevantChunks.length === 0) {
      return chunks.slice(0, Math.min(3, chunks.length)).map((chunk) => ({
        ...chunk,
        relevanceScore: 0.05,
        scoreDetails: { reason: "fallback_context" },
        matchedKeywords: [],
      }));
    }

    return relevantChunks;
  }

  calculateRelevanceScore(chunk, queryKeywords, originalQuery) {
    if (!chunk || !chunk.text || typeof chunk.text !== "string") {
      return { total: 0, details: {}, matchedKeywords: [] };
    }

    const chunkTextLower = chunk.text.toLowerCase();
    const originalQueryLower = originalQuery.toLowerCase();

    let totalScore = 0;
    let exactMatches = 0;
    let partialMatches = 0;
    let matchedKeywords = [];

    queryKeywords.forEach((keyword) => {
      const keywordLower = keyword.toLowerCase();

      const exactMatchRegex = new RegExp(
        `\\b${this.escapeRegex(keywordLower)}\\b`,
        "g"
      );
      const exactMatchCount = (chunkTextLower.match(exactMatchRegex) || [])
        .length;

      if (exactMatchCount > 0) {
        exactMatches += exactMatchCount;
        matchedKeywords.push(keyword);

        let keywordScore = exactMatchCount * 10;

        if (keyword.length > 5) {
          keywordScore *= 1.5;
        }

        if (this.isTechnicalTerm(keyword)) {
          keywordScore *= 2;
        }

        totalScore += keywordScore;
      }

      const partialMatchCount = (
        chunkTextLower.match(new RegExp(this.escapeRegex(keywordLower), "g")) ||
        []
      ).length;
      const additionalPartialMatches = Math.max(
        0,
        partialMatchCount - exactMatchCount
      );

      if (additionalPartialMatches > 0) {
        partialMatches += additionalPartialMatches;
        totalScore += additionalPartialMatches * 2;
      }
    });

    const uniqueKeywordMatches = matchedKeywords.length;
    if (uniqueKeywordMatches > 1) {
      totalScore *= 1 + uniqueKeywordMatches * 0.2;
    }

    if (
      originalQueryLower.length > 10 &&
      chunkTextLower.includes(originalQueryLower)
    ) {
      totalScore *= 1.5;
    }

    const normalizedScore = totalScore / Math.sqrt(chunk.text.length / 100);

    return {
      total: normalizedScore,
      details: {
        exactMatches,
        partialMatches,
        uniqueWords: uniqueKeywordMatches,
        chunkLength: chunk.text.length,
      },
      matchedKeywords,
    };
  }

  extractKeywords(query) {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "what",
      "how",
      "why",
      "when",
      "where",
      "this",
      "that",
      "these",
      "those",
      "from",
      "into",
      "about",
      "give",
      "brief",
      "tell",
      "show",
      "me",
      "please",
      "you",
      "your",
      "my",
      "i",
      "we",
      "they",
      "them",
      "their",
      "there",
      "here",
    ]);

    const keywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => {
        return (
          word.length > 2 &&
          !stopWords.has(word) &&
          /^[a-zA-Z]+$/.test(word) &&
          !word.match(/^(what|how|why|when|where)$/)
        );
      })
      .filter((word, index, array) => array.indexOf(word) === index);

    return keywords;
  }

  isTechnicalTerm(word) {
    const technicalTerms = new Set([
      "name",
      "candidate",
      "experience",
      "education",
      "skills",
      "technologies",
      "projects",
      "developer",
      "engineer",
      "programmer",
      "analyst",
      "manager",
      "intern",
      "consultant",
      "senior",
      "junior",
      "lead",
      "architect",
      "designer",
      "specialist",
      "javascript",
      "typescript",
      "python",
      "java",
      "cpp",
      "csharp",
      "php",
      "ruby",
      "go",
      "rust",
      "swift",
      "kotlin",
      "scala",
      "perl",
      "shell",
      "bash",
      "react",
      "angular",
      "vue",
      "nodejs",
      "express",
      "django",
      "flask",
      "spring",
      "laravel",
      "rails",
      "jquery",
      "bootstrap",
      "tailwind",
      "sass",
      "scss",
      "html",
      "css",
      "sql",
      "nosql",
      "mongodb",
      "mysql",
      "postgresql",
      "redis",
      "elasticsearch",
      "docker",
      "kubernetes",
      "aws",
      "azure",
      "gcp",
      "jenkins",
      "git",
      "github",
      "gitlab",
      "university",
      "college",
      "institute",
      "degree",
      "bachelor",
      "master",
      "phd",
      "certification",
      "diploma",
      "course",
      "training",
      "workshop",
      "seminar",
      "company",
      "organization",
      "corporation",
      "startup",
      "enterprise",
      "agency",
      "firm",
      "department",
      "team",
      "project",
      "product",
      "service",
      "client",
      "customer",
    ]);

    return technicalTerms.has(word.toLowerCase());
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
    const words = text.split(" ");
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    return {
      text: text,
      page: page,
      startIndex: startIndex,
      endIndex: endIndex,
      chunkIndex: chunkIndex,
      wordCount: words.length,
      sentenceCount: sentences.length,
      characterCount: text.length,
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

    const totalCharacters = chunks.reduce(
      (sum, chunk) => sum + chunk.characterCount,
      0
    );
    const totalWords = chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0);

    return {
      totalChunks: chunks.length,
      totalCharacters: totalCharacters,
      totalWords: totalWords,
      averageChunkSize: Math.round(totalCharacters / chunks.length),
      averageWordsPerChunk: Math.round(totalWords / chunks.length),
      sizeRange: {
        min: Math.min(...chunks.map((c) => c.characterCount)),
        max: Math.max(...chunks.map((c) => c.characterCount)),
      },
    };
  }
}

module.exports = new PDFService();
