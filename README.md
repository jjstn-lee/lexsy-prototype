# Lexsy Prototype - Legal Document Assistant

A conversational AI system for filling out legal document templates. Users upload a DOCX template, and the system guides them through filling in all placeholders via natural conversation.

## System Overview

Lexsy is built as a Next.js application that uses a multi-agent architecture to intelligently process legal documents. The system:
1. **Detects** placeholders in uploaded DOCX files
2. **Guides** users through filling each placeholder via conversational questions
3. **Extracts** values from user responses
4. **Validates** extracted values
5. **Generates** a completed document with all placeholders filled

## Architecture

### High-Level Flow

```
Upload Document → Detection Agent → Session Created → User Conversations → Orchestrator → Multiple Agents → Completed Document
```

### Technology Stack

- **Framework**: Next.js 16 (App Router)
- **AI Models**: 
  - Google Gemini 2.5 Flash (via LangChain)
- **Document Processing**: 
  - `mammoth` - DOCX text extraction
  - `docxtemplater` / `pizzip` - DOCX manipulation
- **State Management**: In-memory Map-based session store
- **UI**: React 19, Tailwind CSS, Radix UI components

### Core Components

1. **API Routes** (`app/api/`)
   - `/api/upload` - Document upload and initial processing
   - `/api/chat` - Conversational message handling
   - `/api/download/[id]` - Generated document download

2. **Agent System** (`lib/agents/`)
   - Base agent class providing common functionality
   - Specialized agents for different tasks
   - Orchestrator coordinating agent interactions

3. **Document Processing** (`lib/`)
   - Document store (session management)
   - DOCX generation with placeholder replacement
   - Type definitions

4. **UI Components** (`components/`)
   - Chat interface
   - Document preview
   - File upload

## Agent Architecture

The system uses a **multi-agent orchestration pattern** where specialized agents handle specific responsibilities, coordinated by an `Orchestrator` that routes user messages appropriately.

### BaseAgent

**Purpose**: Abstract base class providing common functionality to all agents.

**Key Features**:
- Shared LangChain Google Generative AI model instance (`gemini-2.5-flash`)
- Conversation history management
- Structured output generation via JSON schema
- Helper methods for placeholder state queries

**Implementation Details**:
- Uses temperature 0.7 for balanced creativity/consistency
- Implements `withStructuredOutput()` for JSON schema-based responses
- Handles Google API quirks (removes 'name' field from schema)
- All agents share same model instance for consistency

### DetectionAgent

**Purpose**: Analyzes uploaded DOCX files to identify all placeholders that need filling.

**Key Features**:
- Processes entire document text (extracted via `mammoth`)
- Handles documents too large for single API call by chunking
- Deduplicates placeholders across chunks
- Identifies various placeholder patterns:
  - Explicit: `[___]`, `{{name}}`, `[COMPANY NAME]`
  - Blank lines: `________`
  - Labeled fields: "Name:" followed by underscores
  - Signature placeholders

**Process**:
1. Extract raw text from DOCX using `mammoth`
2. If document > 30,000 chars, split into overlapping chunks (beginning, middle sections, end)
3. Use Gemini with JSON output mode to detect placeholders per chunk
4. Deduplicate based on placeholder keys
5. Return structured `PlaceholderDetected[]` array

**Implementation Details**:
- Uses lower temperature (0.3) for more deterministic detection
- JSON sanitization to handle control characters in document text
- Special attention to end of document (common failure point)
- Overlapping chunks (2000 chars) prevent missing placeholders at boundaries

### ClassifierAgent

**Purpose**: Classifies user messages into intent categories to route to appropriate handlers.

**Query Types**:
- `answer` - Direct response to a question about a placeholder
- `question` - User asking about the document/placeholders/process
- `clarification` - User needs help or is confused
- `correction` - User correcting a previous answer
- `skip` - User wants to skip current placeholder and return later
- `general` - General conversation unrelated to form filling

**Implementation**:
- Uses structured output (JSON schema) for reliable classification
- Considers context: last question asked, filled placeholders
- Returns confidence score and optional reasoning
- Classification accuracy is critical for proper message routing

### QuestionAgent

**Purpose**: Generates natural, friendly questions asking users for placeholder values.

**Key Features**:
- Asks about ONE placeholder at a time
- Maintains separate conversation history for question generation
- Generates contextually appropriate questions based on placeholder type and description
- Can acknowledge previous responses separately from asking next question

**Implementation Details**:
- Uses dedicated conversation history separate from extraction
- System prompt emphasizes: professional, friendly, concise, one-at-a-time
- Explicit instruction: "Do NOT acknowledge previous responses" when generating questions
- History accumulates over time, potentially reaching token limits for very long sessions

### ExtractionAgent

**Purpose**: Extracts placeholder values from user responses.

**Key Features**:
- Maps user input to correct placeholder keys
- Preserves exact formatting (currency symbols, percentages, commas)
- Allows minimal normalization (spelling, whitespace, date formats)
- Handles synonym mapping (e.g., "company" → "company_name")
- Prioritizes mapping to current placeholder when context available

**Normalization Rules**:
- ✅ Preserves: `$`, `%`, commas in numbers
- ✅ Allows: spelling corrections, whitespace normalization, date standardization (to YYYY-MM-DD)
- ✅ Converts written numbers to digits ("five thousand" → "5000")
- ✅ Removes currency words but keeps symbols ("50 dollars" → "$50")

**Implementation Details**:
- Uses structured output with array of key-value pairs
- Maintains extraction history separate from questions
- Context-aware: uses `lastQuestion` and `currentPlaceholderKey` to improve mapping accuracy
- Synonym mapping is currently hardcoded but could be LLM-enhanced

### ExplanationAgent

**Purpose**: Answers user questions about the document, placeholders, or process.

**Key Features**:
- Answers questions without asking follow-ups (explicit system instruction)
- Context-aware: understands current placeholder and conversation state
- Strips trailing questions from responses to maintain conversation flow
- Can explain specific placeholders in detail

**Implementation Details**:
- Maintains conversation history for context
- Post-processes responses to remove patterns like "Do you have any other questions?"
- Provides placeholder-specific information when available
- Pattern matching for question stripping may miss edge cases

### ValidationAgent

**Purpose**: Validates extracted values for correctness and completeness.

**Key Features**:
- Two-stage validation: basic type checks + LLM-based nuanced validation
- Type-specific validation: email format, date parsing, number/currency parsing
- Returns errors, warnings, and optional suggestions
- Handles edge cases (empty values, malformed data)

**Validation Types**:
- **Email**: Regex-based format check
- **Date**: JavaScript Date parsing validation
- **Number/Currency**: Parse float (handling symbols)
- **Address**: Length-based warning (minimum 10 chars)
- **Text**: Non-empty check

**Implementation Details**:
- Basic validation catches obvious errors quickly
- LLM validation provides contextual checks (reasonableness, completeness)
- Falls back to basic validation if LLM call fails
- Dual validation approach adds latency but significantly improves quality


### Orchestrator

**Purpose**: Central coordinator that routes user messages and coordinates agent interactions.

**Key Responsibilities**:
1. **Message Routing**: Uses ClassifierAgent to determine user intent, routes to appropriate handler
2. **State Management**: Tracks current placeholder, last question, skipped placeholders
3. **Flow Control**: Manages question sequencing, completion detection
4. **Response Assembly**: Combines agent outputs into coherent responses

**Handler Methods**:
- `handleAnswer()` - Extracts value, validates, asks next question or completes
- `handleQuestion()` - Provides explanation, re-asks or moves to next question
- `handleClarification()` - Explains, re-asks current question
- `handleCorrection()` - Updates value, validates, continues
- `handleSkip()` - Marks placeholder as skipped, moves to next
- `handleGeneral()` - Handles general conversation, optionally continues form

**State Management**:
- `currentPlaceholderKey` - Tracks which placeholder user is responding to
- `lastQuestion` - Remembers last question for context
- `skippedPlaceholders` - Array of placeholder keys user skipped

## Document Processing

### Upload Flow

1. User uploads DOCX file via `/api/upload`
2. Extract text using `mammoth.extractRawText()`
3. DetectionAgent analyzes text to find placeholders
4. Google Gemini generates friendly greeting mentioning first placeholder
5. Session created and stored in memory
6. Session ID returned to client

### Document Generation

The system uses **direct XML manipulation** for placeholder replacement to preserve document formatting:

1. **Load DOCX as ZIP**: DOCX files are ZIP archives
2. **Extract `word/document.xml`**: Main document content
3. **Find placeholders in XML**: Search `<w:t>` text nodes for placeholder patterns
4. **Replace with escaped values**: XML-escape replacement values
5. **Handle split nodes**: Some placeholders span multiple XML text nodes
6. **Validate XML**: Check tag balance before saving
7. **Regenerate DOCX**: Update ZIP archive with modified XML

**Fallback Strategy**: If XML manipulation fails, falls back to text replacement and regenerates document using `docx` library (loses original formatting).

## Key Implementation Decisions

### 1. Multi-Agent Architecture

**Decision**: Separate specialized agents rather than single monolithic agent.

**Rationale**:
- Each agent has focused responsibility
- Easier to test and debug individual components
- Allows independent optimization (different temperatures, prompts)
- Clear separation of concerns

### 2. In-Memory Session Store

**Decision**: Store sessions in global Map rather than database.

**Rationale**:
- Simpler implementation for prototype
- Fast access, no external dependencies
- Sufficient for single-server deployments

### 3. Structured Output via JSON Schema

**Decision**: Use LangChain's `withStructuredOutput()` for agent responses.

**Rationale**:
- Ensures consistent response format
- Reduces parsing errors
- Type-safe responses

### 4. Separate Conversation Histories

**Decision**: QuestionAgent and ExtractionAgent maintain separate histories.

**Rationale**:
- Question generation shouldn't be influenced by extraction acknowledgments
- Keeps each agent's context focused
- Prevents degradation of question quality over time

### 5. Format Preservation in Extraction

**Decision**: Preserve exact user input including symbols.

**Rationale**:
- Legal documents require exact values (currency, percentages, dates)
- User typed what they meant - don't reformat
- Prevents data loss

### 6. XML-Based Document Generation

**Decision**: Direct XML manipulation rather than template libraries.

**Rationale**:
- Preserves original formatting perfectly
- More control over replacement
- Works with any DOCX structure

### 7. Chunking for Large Documents

**Decision**: Split documents > 30KB into overlapping chunks for detection.

**Rationale**:
- API token limits
- Ensures end of document is analyzed (common failure point)
- Overlap prevents missing placeholders at boundaries

### 8. Skip Functionality

**Decision**: Allow users to skip placeholders and return to them later.

**Rationale**:
- Better UX - users may not have all information immediately
- Prevents blocking progress
- Skips are tracked separately and handled last

## Trade-offs

This section consolidates all implementation trade-offs across the system:

### Architecture & Design

- **Multi-Agent Complexity**: While the multi-agent architecture provides clear separation of concerns and easier testing, it adds coordination complexity that requires careful Orchestrator design. However, this is mitigated by the orchestration pattern.

- **In-Memory Session Store**: Sessions stored in memory are lost on server restart and don't scale across multiple servers. This is acceptable for prototype/MVP but requires migration to a persistent store for production.

- **Centralized Orchestration**: The Orchestrator contains significant logic that could be split into smaller handlers, but centralization simplifies agent coordination and state management.

### Agent System

- **Shared Model Instance**: All agents share the same Google Gemini model instance, which simplifies configuration but creates potential for rate limiting bottlenecks if many requests occur simultaneously.

- **Separate Conversation Histories**: QuestionAgent and ExtractionAgent maintain separate histories to prevent question quality degradation, but this doubles token usage compared to a single shared history.

- **Structured Output Schema**: Using JSON schema for structured output ensures reliable parsing but requires careful schema design. The trade-off favors reliability over flexibility.

- **Classification Accuracy Dependency**: The entire system depends on ClassifierAgent accuracy - incorrect routing leads to poor user experience. Confidence scores are returned but not currently used for decision-making.

- **History Accumulation**: Conversation histories grow over time, potentially reaching token limits for very long sessions. No automatic cleanup or summarization is currently implemented.

### Document Detection

- **Chunking Strategy**: Large documents are split into overlapping chunks to handle API limits, but this requires deduplication and may still miss placeholders split exactly at chunk boundaries (mitigated by 2000-char overlap).

- **JSON Sanitization**: Document text often contains control characters that break JSON parsing, requiring custom sanitization logic that adds complexity.

- **LLM-Dependent Detection**: Placeholder detection quality depends entirely on LLM understanding of placeholder intent. No fallback detection mechanism exists.

### Value Extraction

- **Format Preservation vs Normalization**: The system preserves exact user input (currency symbols, percentages, commas) but still requires some normalization (whitespace, dates). Finding the right balance is challenging.

- **Hardcoded Synonym Mapping**: Placeholder key mapping uses hardcoded synonyms rather than LLM-based dynamic mapping, limiting flexibility but improving reliability and speed.

- **Context Dependency**: Extraction accuracy heavily depends on context (last question, current placeholder). Without context, mapping accuracy decreases significantly.

### Validation

- **Dual Validation Latency**: Two-stage validation (basic + LLM) provides high-quality checks but adds latency. The system falls back to basic validation if LLM fails, ensuring robustness.

### Document Generation

- **XML Manipulation Complexity**: Direct XML manipulation preserves formatting perfectly but requires complex implementation to handle Word's document structure, including placeholders split across multiple XML text nodes.

- **XML Validation Necessity**: XML must be validated after manipulation to avoid corrupt documents, adding processing overhead.

- **Fallback Format Loss**: If XML manipulation fails, the fallback to text-based regeneration loses all original formatting (tables, styles, headers/footers).

### User Experience

- **Question Stripping Edge Cases**: ExplanationAgent strips trailing questions using pattern matching, which may miss edge cases or unusual phrasings.

- **Skip State Management**: Allowing users to skip placeholders improves flexibility but requires careful state tracking and sequencing logic to handle skipped items correctly.

- **Single-Question Flow**: Asking one question at a time improves clarity but may feel slow for users who could answer multiple fields quickly.

### Performance & Scalability

- **Token Usage**: Multiple conversation histories and extensive context passing increase token usage per request compared to a simpler single-agent approach.

- **Sequential Agent Calls**: The orchestrator makes sequential agent calls (classify → extract → validate → question), which increases latency but improves reliability and debugging.

- **No Caching**: Agent responses and document processing results are not cached, meaning repeated operations process the same content multiple times.

### Error Resilience

- **Graceful Degradation**: The system includes fallbacks (text-based document generation, basic validation) but some failures (detection, classification) have limited recovery options.

- **State Recovery**: No mechanism exists to recover or resume sessions if state becomes corrupted or inconsistent.

## Error Handling

### Graceful Degradation

1. **Detection fails**: Returns empty placeholder array (user can still proceed)
2. **Extraction fails**: Sets `needsClarification` flag, re-asks question
3. **Validation fails**: Returns errors, asks for correction
4. **Document generation fails**: Falls back to text-based replacement
5. **API errors**: Catch blocks return user-friendly error messages

### Logging

Extensive console logging throughout for debugging:
- Agent actions
- API requests/responses
- Document processing steps
- State changes

## Future Improvements

### Scalability

1. **Persistent Session Store**: Move to database (PostgreSQL, Redis)
2. **Session Cleanup**: TTL-based cleanup for expired sessions
3. **Multi-server Support**: Shared session store (Redis cluster)

### Agent Enhancements

1. **Confidence-based Routing**: Use ClassifierAgent confidence scores
2. **Dynamic Synonym Mapping**: LLM-based placeholder key mapping
3. **Multi-turn Clarification**: Allow follow-up questions in ExplanationAgent
4. **Smart Question Ordering**: Prioritize related placeholders

### Document Processing

1. **Format Detection**: Auto-detect placeholder formats during detection
2. **Better Split Node Handling**: Improved algorithm for cross-node placeholders
3. **Format Preservation**: Better handling of tables, lists, headers/footers

### UX Improvements

1. **Preview Updates**: Real-time preview of filled document
2. **Undo/Redo**: Allow users to correct previous answers easily
3. **Bulk Edit**: Fill multiple related placeholders at once
4. **Template Library**: Pre-configured templates with known placeholders

## Getting Started

### Prerequisites

- Node.js 20+
- Google AI API key (for Gemini)

### Installation

```bash
npm install
```

### Environment Variables

Create `.env.local`:

```
GOOGLE_AI_API_KEY=your_google_api_key
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build

```bash
npm run build
npm start
```

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── chat/route.ts          # Chat message handler
│   │   ├── upload/route.ts         # Document upload handler
│   │   └── download/[id]/route.ts  # Document download handler
│   └── page.tsx                    # Main UI page
├── components/
│   ├── ChatInterface.tsx           # Main chat UI
│   ├── DocumentUpload.tsx          # File upload component
│   ├── DocumentPreview.tsx         # Document preview
│   └── ui/                         # Reusable UI components
├── lib/
│   ├── agents/
│   │   ├── BaseAgent.ts            # Base agent class
│   │   ├── Orchestrator.ts         # Central coordinator
│   │   ├── DetectionAgent.ts       # Placeholder detection
│   │   ├── ClassifierAgent.ts      # Intent classification
│   │   ├── QuestionAgent.ts        # Question generation
│   │   ├── ExtractionAgent.ts      # Value extraction
│   │   ├── ExplanationAgent.ts    # Question answering
│   │   └── ValidationAgent.ts     # Value validation
│   ├── documentStore.ts            # Session management
│   ├── generateDocx.ts             # Document generation
│   └── types.ts                    # TypeScript types
└── package.json
```

## License

[Add your license here]