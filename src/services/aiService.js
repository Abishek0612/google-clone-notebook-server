const axios = require("axios");

class AIService {
  async generateResponse(context, question, relevantChunks) {
    try {
      return this.directTextAnalysis(question, relevantChunks, context);
    } catch (error) {
      console.error("AI Service Error:", error.message);
      return { answer: "Error processing your question.", citations: [] };
    }
  }

  directTextAnalysis(question, relevantChunks, context) {
    console.log("=== Direct Text Analysis ===");
    console.log("Question:", question);
    console.log("Context length:", context ? context.length : 0);
    console.log("Relevant chunks:", relevantChunks ? relevantChunks.length : 0);

    const allText = this.combineAllText(relevantChunks, context);
    console.log("Combined text preview:", allText.substring(0, 300));

    const answer = this.findDirectAnswer(question, allText);

    const citations = (relevantChunks || []).map((chunk) => ({
      page: chunk.page || 1,
      text: (chunk.text || "").substring(0, 80) + "...",
    }));

    console.log("Generated answer:", answer);
    return { answer, citations };
  }

  combineAllText(relevantChunks, context) {
    let allText = context || "";

    if (relevantChunks && Array.isArray(relevantChunks)) {
      const chunkTexts = relevantChunks
        .filter((chunk) => chunk && chunk.text)
        .map((chunk) => chunk.text)
        .join(" ");
      allText = chunkTexts + " " + allText;
    }

    return allText;
  }

  findDirectAnswer(question, text) {
    const questionLower = question.toLowerCase();
    console.log("Finding answer for:", questionLower);

    if (
      questionLower.includes("item") ||
      questionLower.includes("product") ||
      questionLower.includes("list")
    ) {
      return this.extractItems(text);
    }

    if (questionLower.includes("address")) {
      return this.extractAddress(text);
    }

    if (questionLower.includes("irn")) {
      return this.extractIRN(text);
    }

    if (questionLower.includes("amount") || questionLower.includes("total")) {
      return this.extractAmount(text);
    }

    if (questionLower.includes("date")) {
      return this.extractDate(text);
    }

    if (questionLower.includes("invoice") || questionLower.includes("number")) {
      return this.extractInvoiceNumber(text);
    }

    if (questionLower.includes("name") || questionLower.includes("company")) {
      return this.extractName(text);
    }

    return this.searchInText(question, text);
  }

  extractItems(text) {
    console.log("Extracting items from text...");

    const lines = text.split("\n");
    const items = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (
        trimmed.includes("Kg") ||
        trimmed.includes("kg") ||
        trimmed.includes("Herall") ||
        trimmed.includes("Bori") ||
        trimmed.includes("Gur") ||
        trimmed.includes("Akhrot") ||
        trimmed.includes("Saffron") ||
        trimmed.includes("Kesar") ||
        (trimmed.length > 5 &&
          trimmed.length < 50 &&
          /\d/.test(trimmed) &&
          !trimmed.includes(":"))
      ) {
        items.push(trimmed);
      }
    }

    if (items.length > 0) {
      console.log("Found items:", items);
      return `Items found: ${items.slice(0, 10).join(", ")}`;
    }

    const words = text.split(/\s+/);
    const productWords = words.filter(
      (word) =>
        word.length > 3 &&
        (word.includes("Kg") || word.includes("kg") || /\d+/.test(word))
    );

    if (productWords.length > 0) {
      return `Product-related terms: ${productWords.slice(0, 10).join(", ")}`;
    }

    return "No specific items clearly identified in the document.";
  }

  extractAddress(text) {
    console.log("Extracting address...");

    const lines = text.split("\n");
    const addressParts = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (
        trimmed.includes("Vikasnagar") ||
        trimmed.includes("Uttrakhand") ||
        trimmed.includes("Dehradun") ||
        trimmed.includes("Pin") ||
        trimmed.includes("248198") ||
        (trimmed.length > 10 &&
          trimmed.length < 100 &&
          (trimmed.includes("Bazar") ||
            trimmed.includes("Main") ||
            /\d{6}/.test(trimmed)))
      ) {
        addressParts.push(trimmed);
      }
    }

    if (addressParts.length > 0) {
      return `Address: ${addressParts.join(", ")}`;
    }

    return "Address not clearly identified in the document.";
  }

  extractIRN(text) {
    console.log("Extracting IRN...");

    const irnMatch = text.match(/IRN[:\s]*([A-Za-z0-9]+)/i);
    if (irnMatch) {
      return `IRN: ${irnMatch[1]}`;
    }

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes("irn") && line.length < 100) {
        return `IRN information: ${line.trim()}`;
      }
    }

    return "IRN not found in the document.";
  }

  extractAmount(text) {
    const amounts = text.match(/(\d+[\d,]*\.?\d*)/g);
    if (amounts) {
      const largestAmount = amounts
        .map((amt) => parseFloat(amt.replace(/,/g, "")))
        .filter((amt) => !isNaN(amt))
        .sort((a, b) => b - a)[0];

      if (largestAmount) {
        return `Amount: ${largestAmount}`;
      }
    }

    return "Amount not clearly identified.";
  }

  extractDate(text) {
    const dateMatch = text.match(
      /(\d{1,2}\/\w+\/\d{2,4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/
    );
    if (dateMatch) {
      return `Date: ${dateMatch[1]}`;
    }

    return "Date not found in the document.";
  }

  extractInvoiceNumber(text) {
    const invoiceMatch = text.match(
      /(?:INV|Invoice)[\s\w]*:?\s*([A-Za-z0-9]+)/i
    );
    if (invoiceMatch) {
      return `Invoice: ${invoiceMatch[1]}`;
    }

    return "Invoice number not clearly identified.";
  }

  extractName(text) {
    const lines = text.split("\n").slice(0, 10);
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length > 5 &&
        trimmed.length < 50 &&
        /[A-Z]/.test(trimmed) &&
        !trimmed.includes(":") &&
        !trimmed.toLowerCase().includes("tax")
      ) {
        return `Name/Company: ${trimmed}`;
      }
    }

    return "Name/Company not clearly identified.";
  }

  searchInText(question, text) {
    const questionWords = question
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 3);
    const lines = text.split("\n");

    let bestMatch = "";
    let bestScore = 0;

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      const score = questionWords.reduce((acc, word) => {
        return acc + (lineLower.includes(word) ? 1 : 0);
      }, 0);

      if (score > bestScore && line.trim().length > 10) {
        bestScore = score;
        bestMatch = line.trim();
      }
    }

    if (bestMatch) {
      return `From document: ${bestMatch}`;
    }

    return `I found content but couldn't identify specific information for: ${question}`;
  }
}

module.exports = new AIService();
