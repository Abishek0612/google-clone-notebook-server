const express = require("express");
const chatController = require("../controllers/chatController");

const router = express.Router();

router.post("/message", chatController.sendMessage);
router.get("/conversation/:pdfId", chatController.getConversation);
router.delete("/conversation/:pdfId/:messageId", chatController.deleteMessage);
router.delete("/conversation/:pdfId/clear", chatController.clearConversation);

router.post("/search-similar", chatController.searchSimilar);

module.exports = router;
