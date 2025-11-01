import { BaseAgent } from "./BaseAgent";
import { DocumentSession } from "../types";

export class ExplanationAgent extends BaseAgent {
  constructor(session: DocumentSession) {
    super(session);
    
    const systemMessageContent = `You are a helpful legal assistant helping a user fill out a ${session.fileName}.
    You can answer questions about:
    - What the document is for
    - What placeholders mean
    - How to fill out the form
    - General questions about the process

    Be professional, friendly, and concise. If you don't know something, say so.
    Don't make up information about the document.

    IMPORTANT: Do NOT ask questions in your response. Only provide explanations and answers. Do NOT suggest moving to other topics or ask if the user has other questions. Just provide the explanation and stop.`;

    this.conversationHistory = [
      this.getSystemMessage(systemMessageContent)
    ];
  }

  async explain(userMessage: string, context?: {
    currentPlaceholder?: string;
    currentPlaceholderKey?: string;
    lastQuestion?: string;
    filledPlaceholders?: string[];
  }): Promise<string> {
    const unfilledPlaceholders = this.getUnfilledPlaceholders();
    const filledPlaceholders = this.getFilledPlaceholders();

    let contextInfo = "";
    if (context?.lastQuestion) {
      contextInfo += `IMPORTANT: The assistant just asked: "${context.lastQuestion}"\n`;
      contextInfo += `If the user is confused or asking for clarification, they are likely asking about this question/placeholder.\n\n`;
    }
    if (context?.currentPlaceholderKey) {
      const currentPlaceholder = this.session.placeholders.find(p => p.key === context.currentPlaceholderKey);
      if (currentPlaceholder) {
        contextInfo += `Current placeholder we're working on: ${currentPlaceholder.label} (${currentPlaceholder.key})\n`;
        if (currentPlaceholder.description) {
          contextInfo += `Description: ${currentPlaceholder.description}\n`;
        }
        contextInfo += `Type: ${currentPlaceholder.type}\n\n`;
      }
    } else if (context?.currentPlaceholder) {
      contextInfo += `Current placeholder we're working on: ${context.currentPlaceholder}\n`;
    }
    
    if (unfilledPlaceholders.length > 0) {
      contextInfo += `\nUnfilled placeholders:\n${unfilledPlaceholders.map(p => 
        `- ${p.label}${p.description ? `: ${p.description}` : ""} (${p.type})`
      ).join("\n")}\n`;
    }
    if (filledPlaceholders.length > 0) {
      contextInfo += `\nFilled placeholders:\n${filledPlaceholders.map(p => 
        `- ${p.label}: ${this.session.responses[p.key]}`
      ).join("\n")}\n`;
    }

    const prompt = `${contextInfo}\n\nUser question: "${userMessage}"

Provide a helpful, concise answer. If the user is asking about a specific placeholder, explain what it means and how to fill it out.

REMEMBER: Do NOT ask any questions. Do NOT suggest moving to other topics. Just provide the explanation and stop.`;

    const messages = [
      ...this.conversationHistory,
      this.getHumanMessage(prompt)
    ];

    const result = await this.model.invoke(messages);
    let explanation = this.extractTextContent(result as unknown as { content?: string | Array<unknown> | { text?: string }; [key: string]: unknown }) || "I'm not sure how to answer that. Could you rephrase your question?";

    explanation = this.stripTrailingQuestions(explanation);
    this.conversationHistory.push(this.getHumanMessage(userMessage));
    this.conversationHistory.push(this.getAIMessage(explanation));

    return explanation;
  }
  private stripTrailingQuestions(text: string): string {
    const questionPatterns = [
      /Do you have any other questions.*?$/i,
      /Would you like to discuss.*?$/i,
      /Are there any other.*?questions.*?$/i,
      /Can I help with anything else.*?$/i,
      /Would you like to continue.*?$/i,
      /Any other.*?questions.*?$/i,
      /Do you want to.*?continue.*?$/i,
      /Should we.*?move on.*?$/i
    ];

    let cleaned = text.trim();
    let changed = false;
    for (const pattern of questionPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        cleaned = cleaned.substring(0, match.index).trim();
        changed = true;
        break;
      }
    }
    if (changed && cleaned.length > 0) {
      const lastChar = cleaned[cleaned.length - 1];
      if (!/[.!?]$/.test(lastChar)) {
        cleaned += '.';
      }
    }

    return cleaned || text;
  }
  async explainPlaceholder(placeholderKey: string): Promise<string> {
    const placeholder = this.session.placeholders.find(p => p.key === placeholderKey);
    
    if (!placeholder) {
      return "I couldn't find that placeholder.";
    }

    const filledValue = this.session.responses[placeholderKey];
    let info = `**${placeholder.label}**\n`;
    info += `Type: ${placeholder.type}\n`;
    if (placeholder.description) {
      info += `Description: ${placeholder.description}\n`;
    }
    if (filledValue) {
      info += `Current value: ${filledValue}`;
    } else {
      info += `Status: Not yet filled`;
    }

    return info;
  }
  resetHistory(): void {
    const systemMessageContent = `You are a helpful legal assistant helping a user fill out a ${this.session.fileName}.
You can answer questions about:
- What the document is for
- What placeholders mean
- How to fill out the form
- General questions about the process

Be professional, friendly, and concise. If you don't know something, say so.
Don't make up information about the document.

IMPORTANT: Do NOT ask questions in your response. Only provide explanations and answers. Do NOT suggest moving to other topics or ask if the user has other questions. Just provide the explanation and stop.`;

    this.conversationHistory = [
      this.getSystemMessage(systemMessageContent)
    ];
  }
}
