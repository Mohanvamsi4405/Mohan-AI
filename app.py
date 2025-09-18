
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from langchain_groq import ChatGroq
from typing import Optional, List
from datetime import datetime
import os
import uuid
import json
from dotenv import load_dotenv
import io
import logging
from pydantic import BaseModel, Field
from PyPDF2 import PdfReader
from groq import Groq

# --- Pydantic models for request and response data validation ---
# These were moved from the separate `models.py` file to make the script self-contained.

class ChatMessage(BaseModel):
    """
    Represents a single message in a chat conversation.
    """
    role: str
    content: str
    timestamp: datetime = Field(default_factory=datetime.now)

class ChatRequest(BaseModel):
    """
    Schema for an incoming chat request.
    """
    message: str
    model_id: str
    conversation_id: Optional[str] = None
    history: List[ChatMessage] = []

class ChatResponse(BaseModel):
    """
    Schema for a chat response.
    """
    response: ChatMessage
    conversation_id: str
    model_used: str

class FileUpload(BaseModel):
    """
    Schema for details about an uploaded file.
    """
    id: str
    filename: str
    content_type: str
    size: int
    upload_time: datetime
    summary: Optional[str] = None

class ModelConfig(BaseModel):
    """
    Schema for a model's configuration details.
    """
    id: str
    name: str
    max_tokens: int
    speed: str
    input_rate: str
    output_rate: str
    category: str

class ModelInfo(BaseModel):
    """
    Schema for the list of available models.
    """
    models: List[ModelConfig]

# --- End of Pydantic models ---


# Load environment variables
load_dotenv()

# Initialize FastAPI
app = FastAPI(
    title="Mohan AI Chat API",
    description="AI Chat API with multiple model support, file upload, and image summarization",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Fetch Groq API key from environment variables
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Available models based on your provided table
MODELS = [
   
    {"id": "deepseek-r1-distill-llama-70b", "name": "DeepSeek R1 Distill Llama 70B", "max_tokens": 100000, "speed": "30", "input_rate": "1K", "output_rate": "6K", "category": "large"},
    {"id": "gemma2-9b-it", "name": "Gemma 2 9B IT", "max_tokens": 500000, "speed": "30", "input_rate": "14.4K", "output_rate": "15K", "category": "fast"},
    {"id": "groq/compound", "name": "Groq Compound", "max_tokens": 0, "speed": "30", "input_rate": "250", "output_rate": "70K", "category": "specialized"},
    {"id": "groq/compound-mini", "name": "Groq Compound Mini", "max_tokens": 0, "speed": "30", "input_rate": "250", "output_rate": "70K", "category": "specialized"},
    {"id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B Instant", "max_tokens": 500000, "speed": "30", "input_rate": "14.4K", "output_rate": "6K", "category": "fast"},
    {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B Versatile", "max_tokens": 100000, "speed": "30", "input_rate": "1K", "output_rate": "12K", "category": "large"},
    {"id": "meta-llama/llama-4-maverick-17b-128e-instruct", "name": "Llama 4 Maverick 17B", "max_tokens": 500000, "speed": "30", "input_rate": "1K", "output_rate": "6K", "category": "general"},
    {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "name": "Llama 4 Scout 17B", "max_tokens": 500000, "speed": "30", "input_rate": "1K", "output_rate": "30K", "category": "general"},
    {"id": "openai/gpt-oss-120b", "name": "GPT OSS 120B", "max_tokens": 200000, "speed": "30", "input_rate": "1K", "output_rate": "8K", "category": "large"},
    {"id": "openai/gpt-oss-20b", "name": "GPT OSS 20B", "max_tokens": 200000, "speed": "30", "input_rate": "1K", "output_rate": "8K", "category": "general"},
    {"id": "qwen/qwen3-32b", "name": "Qwen 3 32B", "max_tokens": 500000, "speed": "60", "input_rate": "1K", "output_rate": "6K", "category": "large"},
    {"id": "moonshotai/kimi-k2-instruct", "name": "Kimi K2 Instruct", "max_tokens": 300000, "speed": "60", "input_rate": "1K", "output_rate": "10K", "category": "general"},
    {"id": "moonshotai/kimi-k2-instruct-0905", "name": "Kimi K2 Instruct 0905", "max_tokens": 300000, "speed": "60", "input_rate": "1K", "output_rate": "10K", "category": "general"},
    {"id": "whisper-large-v3", "name": "Whisper Large V3", "max_tokens": 0, "speed": "20", "input_rate": "2K", "output_rate": "N/A", "category": "audio"},
    {"id": "whisper-large-v3-turbo", "name": "Whisper Large V3 Turbo", "max_tokens": 0, "speed": "20", "input_rate": "2K", "output_rate": "N/A", "category": "audio"}
]

# Helper function to post-process AI output
def format_ai_response(text: str) -> str:
    """
    Ensures that the AI response has proper paragraph breaks
    for better rendering in the frontend.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n") # Normalize line endings
    return "\n\n".join([p.strip() for p in text.split("\n") if p.strip()])


def get_llm(model_id: str):
    """
    Initializes and returns a ChatGroq instance for a given model.
    """
    if not GROQ_API_KEY:
        logger.error("GROQ_API_KEY environment variable not set. Please create a .env file or set the variable.")
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server.")

    try:
        return ChatGroq(
            groq_api_key=GROQ_API_KEY,
            model=model_id,
            temperature=0.1,
            max_retries=3,
        )
    except Exception as e:
        logger.error(f"Failed to initialize model {model_id}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Invalid model: {model_id}")


async def process_file_content(file_content: bytes, file_type: str, model_id: str):
    """
    Processes the content of an uploaded file and generates a summary.
    """
    summary_text = ""

    if file_type.startswith("image/"):
        # Note: This is a placeholder since the model lacks vision capabilities.
        summary_text = "An image file was uploaded. Please describe what you would like to know about it. **Note:** This model does not yet have vision capabilities for analysis."
    elif file_type == "application/pdf":
        try:
            pdf_file = io.BytesIO(file_content)
            reader = PdfReader(pdf_file)
            text_content = ""
            # Extract content from the first 5 pages to avoid memory issues with large files
            for page in reader.pages[:5]:
                text_content += page.extract_text() or ""
            
            truncated_content = text_content[:2000]
            summary_text = f"PDF content summary (first 2000 chars): {truncated_content}"
        except Exception as e:
            logger.error(f"PDF processing failed: {str(e)}")
            summary_text = "A PDF file was uploaded. I encountered an error while processing its content."
    elif file_type.startswith("text/"):
        try:
            # Decode content and truncate to prevent issues with large files
            text_content = file_content.decode('utf-8')[:2000]
            summary_text = f"Text file content (first 2000 chars): {text_content}"
        except:
            summary_text = "A text file was uploaded, but content analysis failed."
    else:
        summary_text = f"A file of type {file_type} was uploaded."

    return summary_text


# API Routes
@app.get("/api/models", response_model=ModelInfo)
async def get_models():
    """
    Returns a list of all available language models.
    """
    model_configs = [ModelConfig(**model) for model in MODELS]
    return {"models": model_configs}

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Handles chat requests and returns an AI-generated response.
    """
    try:
        # Validate model
        model_exists = any(model["id"] == request.model_id for model in MODELS)
        if not model_exists:
            raise HTTPException(status_code=400, detail=f"Model {request.model_id} not found")

        # Initialize LLM
        llm = get_llm(request.model_id)

        # Build a list of messages from the request history and current message
        messages_list = [
            ("system", "You are a direct, final-output-only AI. Provide the minimal necessary output without any preambles, internal monologues, or explanations.")
        ]
        
        # Add past messages from history
        for msg in request.history[-10:]:
            messages_list.append((msg.role, msg.content))
        
        # Add the current user message
        messages_list.append(("human", request.message))

        # Get response from the LLM
        llm_response = llm.invoke(messages_list)
        # Format the AI's response to ensure proper paragraph breaks
        formatted_content = format_ai_response(llm_response.content)
        ai_message = ChatMessage(role="assistant", content=formatted_content, timestamp=datetime.now())

        # Generate conversation ID if not provided
        conversation_id = request.conversation_id or str(uuid.uuid4())

        return ChatResponse(
            response=ai_message,
            conversation_id=conversation_id,
            model_used=request.model_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")

@app.post("/api/upload_and_chat", response_model=ChatResponse)
async def upload_and_chat(
    file: UploadFile = File(...),
    message: Optional[str] = Form(""),
    model_id: str = Form("llama-3.3-70b-versatile")
):
    """
    Handles file upload, summarizes content, and incorporates it into a chat response.
    """
    try:
        model_exists = any(model["id"] == model_id for model in MODELS)
        if not model_exists:
            raise HTTPException(status_code=400, detail=f"Model {model_id} not found")

        file_content = await file.read()
        file_type = file.content_type or "unknown"
        
        llm = get_llm(model_id)
        
        file_summary = await process_file_content(file_content, file_type, model_id)
        
        combined_prompt = f"User query: {message}\n\nFile details: {file.filename}, Type: {file_type}\nFile content: {file_summary}"
        
        messages_list = [
            ("system", "You are a direct, final-output-only AI. Provide the minimal necessary output without any preambles, internal monologues, or explanations."),
            ("human", combined_prompt)
        ]

        llm_response = llm.invoke(messages_list)
        formatted_content = format_ai_response(llm_response.content)
        ai_message = ChatMessage(role="assistant", content=formatted_content, timestamp=datetime.now())

        return ChatResponse(
            response=ai_message,
            conversation_id=str(uuid.uuid4()),
            model_used=model_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload and chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"File upload and chat processing failed: {str(e)}")

@app.post("/api/transcribe", response_model=dict)
async def transcribe(
    audio_file: UploadFile = File(...),
):
    """
    Transcribes an audio file and returns the raw text.
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not set.")

    if audio_file.size > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large (max 25MB)")
    
    try:
        client = Groq(api_key=GROQ_API_KEY)
        file_content = await audio_file.read()
        audio_stream = io.BytesIO(file_content)
        audio_stream.name = audio_file.filename

        transcription_model_id = "whisper-large-v3-turbo"
        transcription_obj = client.audio.transcriptions.create(
            file=audio_stream,
            model=transcription_model_id
        )
        transcription = transcription_obj.text
        
        return {"transcription": transcription}

    except Exception as e:
        logger.error(f"Audio transcription failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Audio transcription failed: {str(e)}")

@app.post("/api/summarize")
async def summarize_content(
    content: str = Form(...),
    model_id: str = Form("llama-3.3-70b-versatile")
):
    """
    Generates a concise summary of the provided text content.
    """
    try:
        llm = get_llm(model_id)
        prompt = f"Please provide a concise summary of the following content. Use markdown formatting like bold, lists, and code blocks for readability:\n\n{content}"
        response = llm.invoke(prompt)
        formatted_summary = format_ai_response(response.content)

        return {"summary": formatted_summary, "model_used": model_id}

    except Exception as e:
        logger.error(f"Summarization error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Summarization failed: {str(e)}")

@app.get("/health")
async def health_check():
    """
    Health check endpoint to verify API is running.
    """
    return {"status": "healthy", "message": "API is running"}

# Mount the static files directory to serve index.html
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
