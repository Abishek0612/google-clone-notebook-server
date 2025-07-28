const express = require("express");
const chatController = require("../controllers/chatController");

const router = express.Router();

router.post("/chat/message", chatController.sendMessage);
router.get("/chat/conversation/:pdfId", chatController.getConversation);
router.delete(
  "/chat/conversation/:pdfId/:messageId",
  chatController.deleteMessage
);
router.delete(
  "/chat/conversation/:pdfId/clear",
  chatController.clearConversation
);

router.post("/message", chatController.sendMessage);
router.get("/conversation/:pdfId", chatController.getConversation);
router.delete("/conversation/:pdfId/:messageId", chatController.deleteMessage);
router.delete("/conversation/:pdfId/clear", chatController.clearConversation);

module.exports = router;
