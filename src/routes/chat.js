const express = require("express");
const chatController = require("../controllers/chatController");

const router = express.Router();

router.post("/message", chatController.sendMessage);
router.get("/conversation/:pdfId", chatController.getConversation);

module.exports = router;
