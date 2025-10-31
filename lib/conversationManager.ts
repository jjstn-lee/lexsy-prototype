// lib/conversationManagerLangChain.ts
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { DocumentSession } from "./types";

// JSON schema for placeholder extraction
const PlaceholderResponseSchema = {
  type: "object" as const,
  description: "Structured response for extracted placeholders",
  properties: {
    understood: { type: "boolean" as const, description: "Whether the user's message was understood" },
    extractedValues: {
      type: "array" as const,
      description: "Array of key-value pairs mapping placeholder IDs to values",
      items: {
        type: "object" as const,
        properties: {
          key: { type: "string" as const, description: "The placeholder ID" },
          value: { type: "string" as const, description: "The extracted value for this placeholder" }
        },
        required: ["key", "value"]
      }
    },
    response: { type: "string" as const, description: "Concise acknowledgment of the user's message" },
    needsClarification: { type: "boolean" as const, description: "Whether clarification is needed" }
  },
  required: ["understood", "extractedValues", "response", "needsClarification"]
};

export class ConversationManager {
  private session: DocumentSession;
  private questionHistory: (SystemMessage | HumanMessage | AIMessage)[];
  private extractionHistory: (HumanMessage | AIMessage)[];
  private model: ChatGoogleGenerativeAI;
  private structuredModel: ReturnType<typeof ChatGoogleGenerativeAI.prototype.withStructuredOutput>;

  constructor(session: DocumentSession) {
    console.log('[ConversationManager] Constructor called');
    console.log('[ConversationManager] Session:', JSON.stringify(session, null, 2));
    
    this.session = session;

    const systemMessageContent = `You are a professional legal assistant helping a user fill out a ${session.fileName}.
Guidelines:
1. Ask about ONE placeholder at a time.
2. Be professional, friendly, and concise.
3. Never make up information.
4. Only acknowledge previous responses in acknowledgment prompts; never combine acknowledgment with the next question.`;
    
    console.log('[ConversationManager] Creating system message:', systemMessageContent);
    
    this.questionHistory = [
      new SystemMessage(systemMessageContent)
    ];

    this.extractionHistory = [];
    console.log('[ConversationManager] Initialized questionHistory and extractionHistory');

    console.log('[ConversationManager] Creating ChatGoogleGenerativeAI model with config:', {
      model: "gemini-2.5-flash",
      temperature: 0.7,
      hasApiKey: !!process.env.GOOGLE_AI_API_KEY
    });
    
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0.7,
      apiKey: process.env.GOOGLE_AI_API_KEY,
    });

    console.log('[ConversationManager] Creating structured output model with schema:', PlaceholderResponseSchema);
    
    this.structuredModel = this.model.withStructuredOutput(PlaceholderResponseSchema, {
      method: "jsonSchema",
      name: "placeholderResponse"
    });
    
    console.log('[ConversationManager] Constructor complete');
  }

  // generate the next question for unfilled placeholder
  async getNextQuestion(): Promise<string> {
    console.log('[ConversationManager.getNextQuestion] Starting');
    console.log('[ConversationManager.getNextQuestion] Current session responses:', JSON.stringify(this.session.responses, null, 2));
    console.log('[ConversationManager.getNextQuestion] Total placeholders:', this.session.placeholders.length);
    
    const nextPlaceholder = this.session.placeholders.find(
      p => !(this.session.responses[p.key]?.trim())
    );

    console.log('[ConversationManager.getNextQuestion] Next placeholder found:', nextPlaceholder ? JSON.stringify(nextPlaceholder, null, 2) : 'none');

    if (!nextPlaceholder) {
      console.log('[ConversationManager.getNextQuestion] All placeholders filled, returning completion message');
      return "All placeholders are filled. I can generate your completed document now.";
    }

    const prompt = `
    Next placeholder to fill:
    Label: ${nextPlaceholder.label}
    Type: ${nextPlaceholder.type}
    ${nextPlaceholder.description ? `Description: ${nextPlaceholder.description}` : ""}

    Already filled placeholders:
    ${JSON.stringify(this.session.responses, null, 2)}

    Generate **only a single, concise, friendly question** asking the user for this placeholder.
    Do NOT acknowledge previous responses.
    Do NOT ask for placeholders that are already filled.
    `;

    console.log('[ConversationManager.getNextQuestion] Generated prompt:', prompt);
    console.log('[ConversationManager.getNextQuestion] Question history length:', this.questionHistory.length);
    console.log('[ConversationManager.getNextQuestion] Question history:', this.questionHistory.map(msg => {
      if (msg instanceof SystemMessage) return 'SystemMessage';
      if (msg instanceof AIMessage) return `AIMessage: ${typeof msg.content === 'string' ? msg.content.substring(0, 50) : 'complex'}`;
      if (msg instanceof HumanMessage) return `HumanMessage: ${typeof msg.content === 'string' ? msg.content.substring(0, 50) : 'complex'}`;
      return 'Unknown';
    }));

    // include questionHistory to maintain conversation context (system message + previous Q&A)
    const messages = [
      ...this.questionHistory,
      new HumanMessage(prompt)
    ];
    
    console.log('[ConversationManager.getNextQuestion] Question history length after filter:', this.questionHistory.length);

    console.log('[ConversationManager.getNextQuestion] Total messages to send:', messages.length);
    console.log('[ConversationManager.getNextQuestion] Invoking model...');
    
    const result = await this.model.invoke(messages);

    console.log('[ConversationManager.getNextQuestion] Model response received');
    console.log('[ConversationManager.getNextQuestion] Raw result content type:', typeof result.content);
    console.log('[ConversationManager.getNextQuestion] Raw result content:', JSON.stringify(result.content, null, 2));

    let question: string;
    if (typeof result.content === 'string') {
      question = result.content;
      console.log('[ConversationManager.getNextQuestion] Extracted question (string):', question);
    } else if (Array.isArray(result.content) && result.content.length > 0) {
      const firstBlock = result.content[0];
      console.log('[ConversationManager.getNextQuestion] Processing array, first block:', firstBlock);
      if (typeof firstBlock === 'string') {
        question = firstBlock;
        console.log('[ConversationManager.getNextQuestion] Extracted question (array string):', question);
      } else if (firstBlock && typeof firstBlock === 'object' && 'text' in firstBlock) {
        question = String(firstBlock.text) || "What should we fill in next?";
        console.log('[ConversationManager.getNextQuestion] Extracted question (object.text):', question);
      } else {
        question = "What should we fill in next?";
        console.log('[ConversationManager.getNextQuestion] Using fallback question');
      }
    } else {
      question = "What should we fill in next?";
      console.log('[ConversationManager.getNextQuestion] Using fallback question (no content)');
    }

    console.log('[ConversationManager.getNextQuestion] Final question:', question);
    this.questionHistory.push(new AIMessage(question));
    console.log('[ConversationManager.getNextQuestion] Added question to history, new length:', this.questionHistory.length);
    console.log('[ConversationManager.getNextQuestion] Returning question');
    return question;
  }

  /** process user response: extract values + acknowledgment ONLY if new */
  async processUserResponse(userMessage: string): Promise<{
    understood?: boolean;
    extractedValues?: Record<string, string>;
    response?: string;
    needsClarification?: boolean;
    isComplete: boolean;
  }> {
    console.log('[ConversationManager.processUserResponse] Starting');
    console.log('[ConversationManager.processUserResponse] User message:', userMessage);
    console.log('[ConversationManager.processUserResponse] Current session responses:', JSON.stringify(this.session.responses, null, 2));
    
    const unfilledPlaceholders = this.session.placeholders.filter(
      p => !(this.session.responses[p.key]?.trim())
    );

    console.log('[ConversationManager.processUserResponse] Unfilled placeholders:', JSON.stringify(unfilledPlaceholders, null, 2));

    const extractionPrompt = `
    Analyze the user's response and extract values ONLY for unfilled placeholders.
    Do NOT ask new questions or combine acknowledgment with other instructions.
    Unfilled placeholders:
    ${JSON.stringify(unfilledPlaceholders, null, 2)}
    User said: "${userMessage}"
    `;

    console.log('[ConversationManager.processUserResponse] Extraction prompt:', extractionPrompt);

    this.extractionHistory.push(new HumanMessage(userMessage));
    console.log('[ConversationManager.processUserResponse] Added user message to extractionHistory, length:', this.extractionHistory.length);

    const messages = [
      ...this.extractionHistory,
      new HumanMessage(extractionPrompt)
    ];

    console.log('[ConversationManager.processUserResponse] Total messages to send:', messages.length);
    console.log('[ConversationManager.processUserResponse] Invoking structured model...');

    const result = await this.structuredModel.invoke(messages);

    console.log('[ConversationManager.processUserResponse] Structured model response received');
    console.log('[ConversationManager.processUserResponse] Raw result:', JSON.stringify(result, null, 2));

    const parsed = 'parsed' in result ? result.parsed : result;
    console.log('[ConversationManager.processUserResponse] Extracted parsed result:', JSON.stringify(parsed, null, 2));
    
    const parsedResult = parsed as {
      understood?: boolean;
      extractedValues?: Array<{ key: string; value: string }> | Record<string, string>;
      response?: string;
      needsClarification?: boolean;
    };

    console.log('[ConversationManager.processUserResponse] Parsed result:', JSON.stringify(parsedResult, null, 2));

    let extractedValuesRecord: Record<string, string> = {};
    if (parsedResult.extractedValues) {
      if (Array.isArray(parsedResult.extractedValues)) {
        extractedValuesRecord = parsedResult.extractedValues.reduce((acc, item) => {
          if (item.key && item.value) acc[item.key] = item.value;
          return acc;
        }, {} as Record<string, string>);
      } else {
        extractedValuesRecord = parsedResult.extractedValues;
      }
    }

    // Define a synonym map for common variations (optional)
    const synonymMap: Record<string, string> = {
      "company": "company_name",
      "company_name": "company_name",
      "founder_name": "founder",
      "founder": "founder",
    };

    // only update session with truly new values
    const newKeys = Object.keys(extractedValuesRecord).filter(
      k => !(this.session.responses[k]?.trim())
    );

    if (newKeys.length > 0) {
      for (const key of newKeys) {
        const extractedValue = extractedValuesRecord[key];

        // normalize Gemini's key, match against placeholder keys and labels
        const lowerKey = key.toLowerCase().trim();
        const mappedKey = synonymMap[lowerKey] ?? lowerKey.replace(/\s+/g, "_");

        const matchingPlaceholder = this.session.placeholders.find(p => {
          if (!p || !p.key || !p.label) return false;

          const normalizedKeyField = p.key.toLowerCase().replace(/\s+/g, "_");
          const normalizedLabel = p.label.toLowerCase().replace(/\s+/g, "_");

          return mappedKey === normalizedKeyField || mappedKey === normalizedLabel;
        });


        if (matchingPlaceholder) {
          this.session.responses[matchingPlaceholder.key] = extractedValue;
          console.log(`[Mapping] Gemini key "${key}" → placeholder ID "${matchingPlaceholder.key}"`);
        } else {
          // fallback: store under raw key if no match
          this.session.responses[key] = extractedValue;
          console.warn(`[Mapping] No matching placeholder for Gemini key "${key}", stored as raw key`);
        }
      }

      if (parsedResult.response) {
        this.extractionHistory.push(new AIMessage(parsedResult.response));
        console.log('[Mapping] Added acknowledgment to extractionHistory:', parsedResult.response);
      }
    } else {
      console.log('[Mapping] No new keys, skipping session update');
    }



    const isComplete = this.session.placeholders.every(
      p => this.session.responses[p.key]?.trim()
    );

    console.log('[ConversationManager.processUserResponse] Is complete:', isComplete);
    console.log('[ConversationManager.processUserResponse] Final return value:', {
      understood: parsedResult.understood,
      extractedValues: extractedValuesRecord,
      response: parsedResult.response,
      needsClarification: parsedResult.needsClarification,
      isComplete
    }); 

    return {
      understood: parsedResult.understood,
      extractedValues: extractedValuesRecord,
      response: parsedResult.response,
      needsClarification: parsedResult.needsClarification,
      isComplete
    };
  }
}
