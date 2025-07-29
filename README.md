# NotebookLM Clone - Backend

## Live Demo

- **Frontend**: https://google-notebook-llm.netlify.app/

- **Backend**: https://google-notebook-clone-server.onrender.com/api

A sophisticated Node.js backend application that powers an AI-powered document chat system, enabling users to upload PDFs and engage in intelligent conversations about their content using advanced vector search and natural language processing.

## Advanced Features

### Core AI & Search Capabilities

- **Hybrid Vector Search**: Advanced semantic search using Google's Gemini API embeddings
- **Intelligent Document Processing**: Advanced PDF text extraction and chunking algorithms optimized for AI analysis
- **Dynamic Context Management**: Smart context preparation with content truncation and relevance scoring
- **Real-time Embedding Generation**: Asynchronous processing with progress tracking and status updates

### Architecture & Performance

- **Microservices Design**: Modular architecture with separated concerns (AI, Vector, PDF, Chat services)
- **Advanced Error Handling**: Comprehensive error management with detailed logging and user-friendly messages
- **Rate Limiting & Security**: Express rate limiting, CORS configuration, and Helmet security middleware
- **Database Optimization**: MongoDB with strategic indexing and efficient data modeling
- **Performance Optimization**: Smart context extraction and intelligent caching mechanisms

### API & Integration

- **RESTful API Design**: Well-structured endpoints following REST principles
- **Real-time Status Updates**: Embedding progress tracking with detailed status information
- **File Management**: Secure file upload handling with validation and cleanup
- **Cross-Origin Support**: Advanced CORS configuration for seamless frontend integration

## Technology Stack

- **Runtime**: Node.js with Express.js framework
- **Database**: MongoDB with Mongoose ODM
- **AI Integration**: Google Gemini API for embeddings and chat completions
- **File Processing**: PDF-parse for document text extraction
- **Security**: Helmet, CORS, Rate limiting middleware
- **Development**: Hot reloading, comprehensive logging, environment-based configuration

## Quick Start

## Environment Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

````env
# Database Configuration
MONGODB_URI=mongodb+srv://uabishek6:abi%40abi12@cluster0.xblmerd.mongodb.net/notebookllm

NODE_ENV=development
PORT=5000
HUGGINGFACE_API_KEY=AIzaSyAb3Dt6ytB4q2QP-sL6F3dbWK9x6qNWBuE

AI_PROVIDER=gemini
GEMINI_API_KEY=AIzaSyAb3Dt6ytB4q2QP-sL6F3dbWK9x6qNWBuE

MONGODB_URI=mongodb+srv://uabishek6:abi%40abi12@cluster0.xblmerd.mongodb.net/notebookllm
HUGGINGFACE_MODEL=microsoft/DialoGPT-medium
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
CLOUDINARY_CLOUD_NAME=dsjgl0cbj
CLOUDINARY_API_KEY=859825451636775
CLOUDINARY_API_SECRET=JDk7hM26QzLpcBe_1KHsxE3sM28
FRONTEND_URL=http://localhost:3000


### Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- Google Gemini API key

### Installation

1. **Clone the repository**
   ```bash
   git clone     -       https://github.com/Abishek0612/google-clone-notebook-server.git
   cd  server
````

### Install dependencies ( node_modules is deleted)

npm install

### Start the server

npm start or npm run dev
