        // Application Configuration
        const CONFIG = {
            API: {
                baseUrl: 'http://localhost:8000', // This will be set by the canvas
                timeout: 15000, // Increased timeout to accommodate file uploads
                retryAttempts: 2,
                retryDelay: 1000,
                endpoints: {
                    health: '/health',
                    models: '/api/models',
                    chat: '/api/chat',
                    upload_and_chat: '/api/upload_and_chat', // New combined endpoint
                    transcribe: '/api/transcribe' // New transcription-only audio endpoint
                }
            },
            DEMO: {
                enabled: false,
                autoEnableOnFailure: false,
                responses: [
                    "I'm a demo AI assistant. Your backend isn't connected, but you can test the interface!",
                    "This is a simulated response. Connect your backend to chat with real AI models.",
                    "Demo mode is active. All responses are simulated until you connect to the backend.",
                    "I'm running in demo mode. To use real AI models, please start your FastAPI backend server.",
                    "This is a test response to show how the chat interface works. Enable backend for real AI."
                ]
            },
            UI: {
                maxLoadingTime: 15000, // Increased loading time
                showTimers: true,
                autoRetry: true,
                connectionStatus: true,
                demoModeIndicator: true
            },
            MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
            MAX_AUDIO_SIZE: 25 * 1024 * 1024, // 25MB for audio
            SUPPORTED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
            SUPPORTED_DOC_TYPES: ['application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            SUPPORTED_AUDIO_TYPES: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/mpga', 'audio/x-m4a', 'audio/flac', 'audio/webm'], // Added supported audio types
            AUTO_SCROLL_DELAY: 100
        };

        // Error messages
        const ERROR_MESSAGES = {
            timeout: "Request timed out after 15 seconds. Please try again.",
            network: "Unable to connect to backend. Please check your backend is running.",
            serverError: "Backend server error. The response may be incomplete.",
            unknown: "An unexpected error occurred. Please try again."
        };

        // Request manager for timeout handling
        class RequestManager {
            constructor() {
                this.activeRequests = new Map();
            }

            async makeRequest(key, requestFn, options = {}) {
                if (this.activeRequests.has(key)) {
                    return this.activeRequests.get(key);
                }

                const controller = new AbortController();
                const timeout = options.timeout || CONFIG.API.timeout;
                
                const timeoutId = setTimeout(() => {
                    controller.abort();
                }, timeout);

                const requestPromise = this.executeRequest(requestFn, controller.signal, timeoutId);
                this.activeRequests.set(key, requestPromise);

                try {
                    const result = await requestPromise;
                    return result;
                } catch (error) {
                    throw error;
                } finally {
                    clearTimeout(timeoutId);
                    this.activeRequests.delete(key);
                }
            }

            async executeRequest(requestFn, signal, timeoutId) {
                try {
                    const result = await requestFn(signal);
                    clearTimeout(timeoutId);
                    return result;
                } catch (error) {
                    clearTimeout(timeoutId);
                    if (error.name === 'AbortError') {
                        throw new Error('timeout');
                    }
                    if (error.message && error.message.includes('Failed to fetch')) {
                        throw new Error('network');
                    }
                    throw error;
                }
            }

            cancelAllRequests() {
                this.activeRequests.clear();
            }
        }

        // Main Application Class
        class MohanAIChatApp {
            constructor() {
                // State
                this.currentModel = null;
                this.messages = [];
                this.models = [];
                this.categories = {};
                this.currentCategory = 'all';
                this.isTyping = false;
                this.isLoading = false;
                this.conversationId = this.generateConversationId();
                this.connectionStatus = 'offline';
                this.searchTerm = '';
                this.messageIdCounter = 0;
                this.demoMode = false;
                this.loadingTimer = null;
                this.loadingStartTime = null;
                this.requestManager = new RequestManager();
                this.attachedFile = null; // New state to hold the attached file
                this.initialize();
            }
            
            async initialize() {
                console.log('Initializing Mohan AI Chat App...');
                this.initializeElements();
                this.bindEvents();
                try {
                    await this.loadModels();
                    this.loadSavedState();
                    this.renderModels();
                    this.connectionStatus = 'online';
                    console.log('Successfully connected to backend API.');
                } catch (error) {
                    this.connectionStatus = 'offline';
                    console.error('Failed to load models from backend:', error);
                    this.models = [];
                    this.renderModels();
                }

                if (this.currentModel) {
                    this.showTab('chat');
                } else {
                    this.showTab('models');
                }
                document.getElementById('app').classList.add('active');
                console.log('Mohan AI Chat App initialized successfully.');
            }

            async loadModels() {
                const url = `${CONFIG.API.baseUrl}${CONFIG.API.endpoints.models}`;
                const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch models: ${response.status}`);
                }
                
                const data = await response.json();
                this.models = data.models;
                
                const uniqueCategories = new Set(this.models.map(m => m.category));
                this.categories = {
                    "general": {"name": "General Purpose", "icon": "💬"},
                    "large": {"name": "Large Models", "icon": "🧠"},
                    "fast": {"name": "Fast Models", "icon": "⚡"},
                    "specialized": {"name": "Specialized", "icon": "🔧"},
                    "audio": {"name": "Audio Processing", "icon": "🎵"}
                };
            }

            initializeElements() {
                this.tabButtons = document.querySelectorAll('.tab-btn');
                this.tabContents = document.querySelectorAll('.main-content');
                this.modelGrid = document.getElementById('model-grid');
                this.categoryTabs = document.querySelectorAll('.category-tab');
                this.searchInput = document.getElementById('model-search');
                this.currentModelName = document.getElementById('current-model-name');
                this.currentModelTokens = document.getElementById('current-model-tokens');
                this.currentModelSpeed = document.getElementById('current-model-speed');
                this.messagesContainer = document.getElementById('messages-container');
                this.messageInput = document.getElementById('message-input');
                this.sendBtn = document.getElementById('send-btn');
                this.fileUploadBtn = document.getElementById('file-upload-btn');
                this.fileInput = document.getElementById('file-input');
                this.fileUploadArea = document.getElementById('file-upload-area');
                this.fileDropZone = document.getElementById('file-drop-zone');
                this.changeModelBtn = document.getElementById('change-model-btn');
                this.clearChatBtn = document.getElementById('clear-chat-btn');
                this.changeModelModal = document.getElementById('change-model-modal');
                this.confirmChangeBtn = document.getElementById('confirm-change-btn');
                this.cancelChangeBtn = document.getElementById('cancel-change-btn');
                this.modalBackdrop = document.getElementById('modal-backdrop');
                this.errorModal = document.getElementById('error-modal');
                this.errorMessage = document.getElementById('error-message');
                this.errorOkBtn = document.getElementById('error-ok-btn');
                this.errorBackdrop = document.getElementById('error-backdrop');
                this.loadingOverlay = document.getElementById('loading-overlay');
                this.loadingText = document.getElementById('loading-text');
                this.loadingSubtext = document.getElementById('loading-subtext');
                this.timerText = document.getElementById('timer-text');
                this.cancelLoadingBtn = document.getElementById('cancel-loading-btn');
                this.fileAttachmentContainer = document.getElementById('file-attachment-container');
            }

            bindEvents() {
                this.tabButtons.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const tab = btn.dataset.tab;
                        this.showTab(tab);
                    });
                });
                
                this.categoryTabs.forEach(tab => {
                    tab.addEventListener('click', (e) => {
                        const category = e.target.dataset.category;
                        this.filterByCategory(category);
                    });
                });

                if (this.searchInput) {
                    this.searchInput.addEventListener('input', (e) => {
                        this.searchTerm = e.target.value.toLowerCase().trim();
                        this.renderModels();
                    });
                }

                if (this.messageInput) {
                    this.messageInput.addEventListener('input', () => {
                        this.autoResizeTextarea();
                        this.updateSendButton();
                    });

                    this.messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            this.sendMessage();
                        }
                    });
                }

                if (this.sendBtn) {
                    this.sendBtn.addEventListener('click', () => this.sendMessage());
                }

                if (this.changeModelBtn) {
                    this.changeModelBtn.addEventListener('click', () => this.showChangeModelModal());
                }

                if (this.clearChatBtn) {
                    this.clearChatBtn.addEventListener('click', () => this.clearChat());
                }

                if (this.confirmChangeBtn) {
                    this.confirmChangeBtn.addEventListener('click', () => {
                        this.hideModal();
                        this.goToModelSelection();
                    });
                }

                if (this.cancelChangeBtn) {
                    this.cancelChangeBtn.addEventListener('click', () => this.hideModal());
                }

                if (this.modalBackdrop) {
                    this.modalBackdrop.addEventListener('click', () => this.hideModal());
                }
                
                if (this.errorOkBtn) {
                    this.errorOkBtn.addEventListener('click', () => this.hideErrorModal());
                }
                
                if (this.errorBackdrop) {
                    this.errorBackdrop.addEventListener('click', () => this.hideErrorModal());
                }

                if (this.cancelLoadingBtn) {
                    this.cancelLoadingBtn.addEventListener('click', () => {
                        this.requestManager.cancelAllRequests();
                        this.hideLoading();
                        this.addMessage('ai', 'Operation was cancelled by user.', { cancelled: true });
                    });
                }

                this.setupFileUpload();
            }
            
            showTab(tabName) {
                this.tabButtons.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tabName);
                });
                this.tabContents.forEach(content => {
                    content.classList.toggle('active', content.id === `${tabName}-tab`);
                });
            }

            setupFileUpload() {
                if (this.fileUploadBtn) {
                    this.fileUploadBtn.addEventListener('click', () => this.toggleFileUpload());
                }

                if (this.fileInput) {
                    this.fileInput.addEventListener('change', (e) => {
                        if (e.target.files.length > 0) {
                            this.attachedFile = e.target.files[0];
                            this.renderFileAttachment();
                            this.updateSendButton();
                            this.hideFileUploadArea();
                        }
                        e.target.value = '';
                    });
                }

                if (this.fileDropZone) {
                    this.fileDropZone.addEventListener('click', (e) => {
                        if (e.target.tagName !== 'INPUT' && this.fileInput) {
                            this.fileInput.click();
                        }
                    });

                    this.fileDropZone.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        this.fileDropZone.classList.add('drag-over');
                    });
                    
                    this.fileDropZone.addEventListener('dragleave', (e) => {
                        e.preventDefault();
                        this.fileDropZone.classList.remove('drag-over');
                    });
                    
                    this.fileDropZone.addEventListener('drop', (e) => {
                        e.preventDefault();
                        this.fileDropZone.classList.remove('drag-over');
                        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                            this.attachedFile = e.dataTransfer.files[0];
                            this.renderFileAttachment();
                            this.updateSendButton();
                            this.hideFileUploadArea();
                        }
                    });
                }
            }

            renderFileAttachment() {
                if (!this.fileAttachmentContainer) return;

                this.fileAttachmentContainer.innerHTML = '';
                if (this.attachedFile) {
                    const fileIcon = this.getFileIcon(this.attachedFile.type);
                    const attachmentElement = document.createElement('div');
                    attachmentElement.className = 'file-attachment-preview';
                    attachmentElement.innerHTML = `
                        <span class="file-icon">${fileIcon}</span>
                        <span class="file-name">${this.attachedFile.name}</span>
                        <button class="remove-file-btn" type="button" title="Remove file">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                    `;
                    this.fileAttachmentContainer.appendChild(attachmentElement);
                    attachmentElement.querySelector('.remove-file-btn').addEventListener('click', () => {
                        this.attachedFile = null;
                        this.renderFileAttachment();
                        this.updateSendButton();
                    });
                }
            }

            getFileIcon(mimeType) {
                if (mimeType.startsWith('image')) return '🖼️';
                if (mimeType.startsWith('audio')) return '🎵';
                if (mimeType.includes('pdf')) return '📄';
                if (mimeType.includes('text')) return '📝';
                return '📎';
            }

            hideFileUploadArea() {
                if (this.fileUploadArea) {
                    this.fileUploadArea.classList.add('hidden');
                    this.fileUploadBtn.classList.remove('active');
                }
            }

            toggleFileUpload() {
                if (this.fileUploadArea) {
                    this.fileUploadArea.classList.toggle('hidden');
                    this.fileUploadBtn.classList.toggle('active');
                    
                    if (!this.fileUploadArea.classList.contains('hidden')) {
                        this.fileUploadArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }

            loadSavedState() {
                try {
                    const savedModelId = localStorage.getItem('selectedModel');
                    const savedMessages = localStorage.getItem('chatMessages');
                    
                    if (savedModelId) {
                        const savedModel = this.models.find(m => m.id === savedModelId);
                        if (savedModel) {
                            this.currentModel = savedModel;
                            this.updateCurrentModelDisplay();
                        }
                    }

                    if (savedMessages) {
                        try {
                            this.messages = JSON.parse(savedMessages);
                        } catch (e) {
                            this.messages = [];
                        }
                    }
                } catch (error) {
                    console.warn('Failed to load saved state');
                }
            }

            saveState() {
                try {
                    if (this.currentModel) {
                        localStorage.setItem('selectedModel', this.currentModel.id);
                    }
                    localStorage.setItem('chatMessages', JSON.stringify(this.messages));
                } catch (error) {
                    console.warn('Failed to save state');
                }
            }

            renderModels() {
                if (!this.modelGrid) return;

                const filteredModels = this.getFilteredModels();
                this.modelGrid.innerHTML = '';
                
                if (filteredModels.length === 0) {
                    this.modelGrid.innerHTML = `<div class="no-models"><h3>No models found</h3><p>Try adjusting your search terms or category filters.</p></div>`;
                    return;
                }
                
                filteredModels.forEach((model) => {
                    const modelCard = this.createModelCard(model);
                    this.modelGrid.appendChild(modelCard);
                });
            }

            createModelCard(model) {
                const card = document.createElement('div');
                card.className = `model-card category-${model.category}`;
                card.dataset.modelId = model.id;

                const categoryInfo = this.categories[model.category] || { name: model.category, icon: "🤖" };
                
                card.innerHTML = `
                    <div class="category-badge">
                        <span>${categoryInfo.icon}</span>
                        <span>${categoryInfo.name}</span>
                    </div>
                    <h3 class="model-name">${model.name}</h3>
                    <div class="model-specs">
                        <div class="spec-item">
                            <span class="spec-label">Max Tokens</span>
                            <span class="spec-value">${this.formatTokens(model.max_tokens)}</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-label">Speed</span>
                            <span class="spec-value">${model.speed}s</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-label">Input Rate</span>
                            <span class="spec-value">${model.input_rate}</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-label">Output Rate</span>
                            <span class="spec-value">${model.output_rate}</span>
                        </div>
                    </div>
                    <button class="btn btn--primary btn--full-width select-model-btn">
                        Select Model
                    </button>
                `;

                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectModel(model);
                });

                return card;
            }

            formatTokens(tokens) {
                if (tokens === 0) return 'N/A';
                if (tokens >= 1000000) return Math.round(tokens / 1000000) + 'M';
                if (tokens >= 1000) return Math.round(tokens / 1000) + 'K';
                return tokens.toString();
            }

            getFilteredModels() {
                let filtered = [...this.models];
                if (this.currentCategory !== 'all') {
                    filtered = filtered.filter(model => model.category === this.currentCategory);
                }
                if (this.searchTerm) {
                    filtered = filtered.filter(model => 
                        model.name.toLowerCase().includes(this.searchTerm) ||
                        model.category.toLowerCase().includes(this.searchTerm) ||
                        model.id.toLowerCase().includes(this.searchTerm)
                    );
                }
                return filtered;
            }

            filterByCategory(category) {
                this.currentCategory = category;
                this.categoryTabs.forEach(tab => {
                    tab.classList.toggle('active', tab.dataset.category === category);
                });
                this.renderModels();
            }

            selectModel(model) {
                this.currentModel = model;
                this.updateCurrentModelDisplay();
                this.showTab('chat');
                this.clearChat();
                this.saveState();
                
                setTimeout(() => {
                    if (this.messageInput) {
                        this.messageInput.focus();
                    }
                }, 300);
            }

            updateCurrentModelDisplay() {
                if (this.currentModel) {
                    if (this.currentModelName) this.currentModelName.textContent = this.currentModel.name;
                    if (this.currentModelTokens) this.currentModelTokens.textContent = this.formatTokens(this.currentModel.max_tokens);
                    if (this.currentModelSpeed) this.currentModelSpeed.textContent = this.currentModel.speed + 's';
                }
            }

            goToModelSelection() {
                this.showTab('models');
                this.currentModel = null;
                localStorage.removeItem('selectedModel');
                this.saveState();
                window.scrollTo(0, 0);
            }

            updateSendButton() {
                if (this.sendBtn && this.messageInput) {
                    const hasText = this.messageInput.value.trim().length > 0;
                    const hasFile = this.attachedFile !== null;
                    this.sendBtn.disabled = !(hasText || hasFile) || this.isLoading;
                }
            }

            async sendMessage() {
                if (!this.messageInput || !this.currentModel || this.isLoading) return;
                
                const text = this.messageInput.value.trim();
                const file = this.attachedFile;

                if (!text && !file) return;
                
                this.isLoading = true;
                this.sendBtn.disabled = true;

                if (file) {
                    this.addMessage('user', `📄 ${file.name} (${this.formatFileSize(file.size)})`);
                }
                if (text) {
                    this.addMessage('user', text);
                }

                this.messageInput.value = '';
                this.autoResizeTextarea();
                this.attachedFile = null;
                this.renderFileAttachment();

                this.showLoading('Processing your request...', 'The AI is generating a response.');

                try {
                    let responseContent = '';
                    if (file && file.type.startsWith('audio')) {
                        // Handle audio transcription separately
                        this.showLoading('Transcribing audio...', 'Please wait as the audio is converted to text.');
                        const transcribedText = await this.callTranscribeAPI(file);
                        this.hideLoading();

                        // this.messageInput.value = transcribedText;
                        this.autoResizeTextarea();
                        this.updateSendButton();
                        
                        this.addMessage('ai', `**Transcription:** ${transcribedText}`);
                        
                        this.isLoading = false;
                        this.sendBtn.disabled = false;
                        return; // Stop here, the user can now send the transcribed text as a chat message
                    } else if (file) {
                        // Handle other file types with a combined query
                        responseContent = await this.callUploadAndChatAPI(file, text);
                    } else {
                        // Handle text-only message
                        responseContent = await this.callChatAPI(text);
                    }
                    
                    await this._streamMessage('ai', responseContent);
                    this.saveState();
                } catch (error) {
                    this.hideLoading();
                    let errorMessage = 'Sorry, an unexpected error occurred. Please try again.';
                    if (error.message.includes('400')) {
                         errorMessage = `Failed to process message. 400 Error: ${error.detail}`;
                    } else if (error.message.includes('405')) {
                         errorMessage = `Failed to process message. 405 Error: Method Not Allowed. This is likely a configuration issue.`;
                    } else if (error.message.includes('timeout')) {
                        errorMessage = ERROR_MESSAGES.timeout;
                    } else if (error.message.includes('network')) {
                        errorMessage = ERROR_MESSAGES.network;
                    } else if (error.message.includes('server')) {
                        errorMessage = ERROR_MESSAGES.serverError;
                    }

                    if (error.message.includes('Audio transcription failed')) {
                        errorMessage = `Failed to transcribe ${file.name}. Please try again.`;
                    }
                    
                    this.showError(errorMessage);
                } finally {
                    this.isLoading = false;
                    this.sendBtn.disabled = false;
                }
            }

            async callTranscribeAPI(file) {
                const url = `${CONFIG.API.baseUrl}${CONFIG.API.endpoints.transcribe}`;
                const formData = new FormData();
                formData.append('audio_file', file);
            
                const response = await this.requestManager.makeRequest('transcribe-' + Date.now(), async (signal) => {
                    const res = await fetch(url, {
                        method: 'POST',
                        body: formData,
                        signal: signal
                    });
                    if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(`HTTP ${res.status}: ${errorData.detail}`);
                    }
                    return res.json();
                });
                return response.transcription;
            }

            async callUploadAndChatAPI(file, message) {
                const url = `${CONFIG.API.baseUrl}${CONFIG.API.endpoints.upload_and_chat}`;
                const formData = new FormData();
                formData.append('file', file);
                formData.append('message', message);
                formData.append('model_id', this.currentModel.id);

                const response = await this.requestManager.makeRequest('upload-' + Date.now(), async (signal) => {
                    const res = await fetch(url, {
                        method: 'POST',
                        body: formData,
                        signal: signal
                    });
                    if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(`HTTP ${res.status}: ${errorData.detail}`);
                    }
                    return res.json();
                });
                return response.response.content;
            }

            async callChatAPI(message) {
                const url = `${CONFIG.API.baseUrl}${CONFIG.API.endpoints.chat}`;
                const response = await this.requestManager.makeRequest('chat-' + Date.now(), async (signal) => {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                        },
                        body: JSON.stringify({
                            model_id: this.currentModel.id,
                            message: message,
                            conversation_id: this.conversationId,
                            history: this.messages
                                .filter(m => m.type !== 'file-attachment')
                                .slice(-10)
                                .map(m => ({ role: m.type, content: m.content, timestamp: m.timestamp }))
                        }),
                        signal: signal
                    });

                    if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(`HTTP ${res.status}: ${errorData.detail}`);
                    }
                    const data = await res.json();
                    return data.response.content || 'No response received';
                });
                return response;
            }
            
            _streamMessage(type, content, options = {}) {
                return new Promise(resolve => {
                    const messageId = ++this.messageIdCounter;
                    const message = {
                        id: messageId,
                        type,
                        content: '',
                        timestamp: Date.now(),
                        ...options
                    };
                    
                    this.messages.push(message);
                    
                    const welcomeMsg = this.messagesContainer?.querySelector('.welcome-message');
                    if (welcomeMsg) {
                        welcomeMsg.remove();
                    }

                    const messageElement = document.createElement('div');
                    messageElement.className = `message ${message.type}`;
                    messageElement.dataset.messageId = message.id;
                    
                    const bubble = document.createElement('div');
                    bubble.className = 'message-bubble';

                    const textContent = document.createElement('div');
                    textContent.className = 'markdown-content';
                    bubble.appendChild(textContent);

                    const timestamp = document.createElement('div');
                    timestamp.className = 'message-timestamp';
                    timestamp.textContent = new Date(message.timestamp).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                    bubble.appendChild(timestamp);

                    messageElement.appendChild(bubble);
                    this.messagesContainer.appendChild(messageElement);
                    this.scrollToBottom();

                    const fullContent = content;
                    let i = 0;
                    const speed = 10; // Typing speed in milliseconds per character
                    function typeWriter() {
                        if (i < fullContent.length) {
                            message.content += fullContent.charAt(i);
                            textContent.innerHTML = marked.parse(message.content);
                            i++;
                            requestAnimationFrame(typeWriter);
                            this.scrollToBottom();
                        } else {
                            this.addCodeBlockActions(textContent);
                            resolve();
                        }
                    }
                    typeWriter = typeWriter.bind(this);
                    typeWriter();
                });
            }

            addMessage(type, content, options = {}) {
                const messageId = ++this.messageIdCounter;
                const message = {
                    id: messageId,
                    type,
                    content,
                    timestamp: Date.now(),
                    ...options
                };
                
                this.messages.push(message);
                this.renderMessage(message);
                
                const welcomeMsg = this.messagesContainer?.querySelector('.welcome-message');
                if (welcomeMsg) {
                    welcomeMsg.remove();
                }
                
                this.scrollToBottom();
            }

            renderMessage(message) {
                if (!this.messagesContainer) return;
                
                const messageElement = document.createElement('div');
                messageElement.className = `message ${message.type}`;
                messageElement.dataset.messageId = message.id;
                
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                
                if (message.content) {
                    const htmlContent = marked.parse(message.content);
                    const textContent = document.createElement('div');
                    textContent.className = 'markdown-content';
                    textContent.innerHTML = htmlContent;
                    bubble.appendChild(textContent);
                    this.addCodeBlockActions(textContent);
                }
                
                const timestamp = document.createElement('div');
                timestamp.className = 'message-timestamp';
                timestamp.textContent = new Date(message.timestamp).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                bubble.appendChild(timestamp);
                
                if (message.error && message.canRetry) {
                    const status = document.createElement('div');
                    status.className = 'message-status error';
                    
                    const errorText = document.createTextNode('Failed to send ');
                    const retryBtn = document.createElement('button');
                    retryBtn.className = 'retry-btn';
                    retryBtn.textContent = 'Retry';
                    retryBtn.onclick = () => this.retryMessage(message.id);
                    
                    status.appendChild(errorText);
                    status.appendChild(retryBtn);
                    bubble.appendChild(status);
                }
                
                messageElement.appendChild(bubble);
                this.messagesContainer.appendChild(messageElement);
            }

            addCodeBlockActions(container) {
                const codeBlocks = container.querySelectorAll('pre');
                codeBlocks.forEach((pre, index) => {
                    const code = pre.querySelector('code');
                    if (code) {
                        const language = code.className.replace('language-', '') || 'txt';
                        const codeContent = code.textContent;

                        const actions = document.createElement('div');
                        actions.className = 'code-actions';

                        const copyBtn = document.createElement('button');
                        copyBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1-1.1-2-1.8-2-4 0-2.2 2-3 2-4 0-1.1.9-2 2-2h4"></path></svg>
                        `;
                        copyBtn.title = 'Copy code';
                        copyBtn.onclick = () => this.copyToClipboard(codeContent);

                        const downloadBtn = document.createElement('button');
                        downloadBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>
                        `;
                        downloadBtn.title = 'Download file';
                        downloadBtn.onclick = () => this.downloadCode(codeContent, language, index);

                        actions.appendChild(copyBtn);
                        actions.appendChild(downloadBtn);
                        pre.appendChild(actions);
                    }
                });
            }

            copyToClipboard(text) {
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(() => {
                        console.log('Code copied to clipboard!');
                    }).catch(err => {
                        console.error('Could not copy text: ', err);
                    });
                }
            }

            downloadCode(content, language, index) {
                const blob = new Blob([content], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `code-snippet-${index}.${language}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            renderMessages() {
                if (!this.messagesContainer) return;
                
                const existingMessages = this.messagesContainer.querySelectorAll('.message');
                existingMessages.forEach(msg => msg.remove());
                
                this.messages.forEach(message => {
                    this.renderMessage(message);
                });
                
                const welcomeMsg = this.messagesContainer.querySelector('.welcome-message');
                if (welcomeMsg && this.messages.length > 0) {
                    welcomeMsg.remove();
                }
                
                this.scrollToBottom();
            }

            formatFileSize(bytes) {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
            }

            autoResizeTextarea() {
                if (this.messageInput) {
                    this.messageInput.style.height = 'auto';
                    this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
                }
            }

            scrollToBottom() {
                if (this.messagesContainer) {
                    setTimeout(() => {
                        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
                    }, CONFIG.AUTO_SCROLL_DELAY);
                }
            }

            clearChat() {
                this.messages = [];
                if (this.messagesContainer) {
                    this.messagesContainer.innerHTML = `
                        <div class="welcome-message">
                            <div class="welcome-content">
                                <h3>Welcome to Mohan AI Chat!</h3>
                                <p>Start a conversation by typing a message below, or upload files for analysis.</p>
                                <div class="feature-list">
                                    <div class="feature-item">📝 Text conversations</div>
                                  
                                    <div class="feature-item">📄 Document processing</div>
                                    <div class="feature-item">🎤 Audio transcription</div>
                                </div>
                            </div>
                        </div>
                    `;
                }
                this.attachedFile = null;
                this.renderFileAttachment();
                this.saveState();
            }

            retryMessage(messageId) {
                const messageIndex = this.messages.findIndex(m => m.id === messageId);
                if (messageIndex >= 0) {
                    const failedMessage = this.messages[messageIndex];
                    if (failedMessage.originalMessage) {
                        this.messages.splice(messageIndex, 1);
                        const messageElement = this.messagesContainer?.querySelector(`[data-message-id="${messageId}"]`);
                        if (messageElement) {
                            messageElement.remove();
                        }
                        
                        if (this.messageInput) {
                            this.messageInput.value = failedMessage.originalMessage;
                            this.autoResizeTextarea();
                            this.updateSendButton();
                            this.sendMessage();
                        }
                    }
                }
            }

            showChangeModelModal() {
                if (this.changeModelModal) {
                    this.changeModelModal.classList.remove('hidden');
                    this.changeModelModal.classList.add('active');
                }
            }

            hideModal() {
                if (this.changeModelModal) {
                    this.changeModelModal.classList.remove('active');
                    setTimeout(() => {
                        this.changeModelModal.classList.add('hidden');
                    }, 250);
                }
            }
            
            showError(message) {
                if (this.errorMessage) this.errorMessage.textContent = message;
                if (this.errorModal) {
                    this.errorModal.classList.remove('hidden');
                    this.errorModal.classList.add('active');
                }
            }

            hideErrorModal() {
                if (this.errorModal) {
                    this.errorModal.classList.remove('active');
                    setTimeout(() => {
                        this.errorModal.classList.add('hidden');
                    }, 250);
                }
            }

            showLoading(text = 'Processing...', subtext = 'Please wait while we process your request') {
                if (this.isLoading) {
                    if (this.loadingText) this.loadingText.textContent = text;
                    if (this.loadingSubtext) this.loadingSubtext.textContent = subtext;
                    return;
                }
                
                this.isLoading = true;
                this.loadingStartTime = Date.now();
                
                if (this.loadingOverlay) {
                    this.loadingOverlay.style.display = 'flex';
                    this.loadingOverlay.classList.remove('hidden');
                    
                    if (this.loadingText) this.loadingText.textContent = text;
                    if (this.loadingSubtext) this.loadingSubtext.textContent = subtext;
                    
                    this.startLoadingTimer();
                }
                
                if (this.loadingTimer) {
                    clearTimeout(this.loadingTimer);
                }
                
                this.loadingTimer = setTimeout(() => {
                    this.hideLoading();
                    this.showError('Request timed out after 15 seconds. Please try again or use demo mode.');
                }, CONFIG.UI.maxLoadingTime);
                
                this.updateSendButton();
            }

            hideLoading() {
                this.isLoading = false;
                
                if (this.loadingTimer) {
                    clearTimeout(this.loadingTimer);
                    this.loadingTimer = null;
                }
                
                if (this.loadingOverlay) {
                    this.loadingOverlay.classList.add('hidden');
                    this.loadingOverlay.style.display = 'none';
                }
                
                this.updateSendButton();
            }

            startLoadingTimer() {
                if (!CONFIG.UI.showTimers || !this.timerText) return;
                
                const updateTimer = () => {
                    if (!this.isLoading || !this.loadingStartTime) return;
                    
                    const elapsed = Date.now() - this.loadingStartTime;
                    const remaining = Math.max(0, Math.ceil((CONFIG.UI.maxLoadingTime - elapsed) / 1000));
                    
                    if (this.timerText) {
                        this.timerText.textContent = `${remaining}s`;
                    }
                    
                    if (remaining > 0 && this.isLoading) {
                        setTimeout(updateTimer, 1000);
                    }
                };
                
                updateTimer();
            }

            generateConversationId() {
                return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }
        }

        new MohanAIChatApp();