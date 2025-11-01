import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { DocumentSession } from "../types";

export type Message = SystemMessage | HumanMessage | AIMessage;

export abstract class BaseAgent {
  protected session: DocumentSession;
  protected model: ChatGoogleGenerativeAI;
  protected conversationHistory: Message[];

  constructor(session: DocumentSession) {
    this.session = session;
    if (!this.session.skippedPlaceholders) {
      this.session.skippedPlaceholders = [];
    }
    
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0.7,
      apiKey: process.env.GOOGLE_AI_API_KEY,
    });

    this.conversationHistory = [];
  }

  protected getSystemMessage(content: string): SystemMessage {
    return new SystemMessage(content);
  }

  protected getHumanMessage(content: string): HumanMessage {
    return new HumanMessage(content);
  }

  protected getAIMessage(content: string): AIMessage {
    return new AIMessage(content);
  }

  protected addToHistory(message: Message): void {
    this.conversationHistory.push(message);
  }

  protected getUnfilledPlaceholders() {
    return this.session.placeholders.filter(
      p => !(this.session.responses[p.key]?.trim())
    );
  }

  protected getFilledPlaceholders() {
    return this.session.placeholders.filter(
      p => this.session.responses[p.key]?.trim()
    );
  }

  protected isComplete(): boolean {
    return this.session.placeholders.every(
      p => this.session.responses[p.key]?.trim()
    );
  }

  protected getStructuredModel(schema: {
    type: string;
    description?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    name?: string;
    [key: string]: unknown;
  }) {
    // Google API doesn't accept 'name' in JSON schema
    const { name, ...schemaWithoutName } = schema;
    
    return this.model.withStructuredOutput(schemaWithoutName, {
      method: "jsonSchema",
      name: name || "structuredResponse"
    });
  }

  protected extractTextContent(result: {
    content?: string | Array<unknown> | { text?: string };
    [key: string]: unknown;
  }): string {
    if (typeof result.content === 'string') {
      return result.content;
    }
    
    if (Array.isArray(result.content) && result.content.length > 0) {
      const firstBlock = result.content[0];
      if (typeof firstBlock === 'string') {
        return firstBlock;
      }
      if (firstBlock && typeof firstBlock === 'object' && 'text' in firstBlock) {
        return String(firstBlock.text) || "";
      }
    }
    
    return "";
  }
}
