from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: Optional[datetime] = None

class Conversation(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: str
    messages: List[ChatMessage]
    model_id: str
    created_at: datetime
    updated_at: datetime

class ModelConfig(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: str
    name: str
    max_tokens: int
    speed: str
    input_rate: str
    output_rate: str
    category: str
    description: Optional[str] = None

class FileUpload(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: str
    filename: str
    content_type: str
    size: int
    upload_time: datetime
    summary: Optional[str] = None

class ChatRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_id: str
    message: str
    conversation_id: Optional[str] = None
    history: Optional[List[ChatMessage]] = []

class ChatResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    response: ChatMessage
    conversation_id: str
    model_used: str

class ModelInfo(BaseModel):
    models: List[ModelConfig]
