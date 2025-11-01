import { BaseAgent } from "./BaseAgent";
import { DocumentSession } from "../types";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

export class QuestionAgent extends BaseAgent {
  private questionHistory: (SystemMessage | HumanMessage | AIMessage)[];

  constructor(session: DocumentSession) {
    super(session);
    
    const systemMessageContent = `You are a professional legal assistant helping a user fill out a ${session.fileName}.
    Guidelines:
    1. Ask about ONE placeholder at a time.
    2. Be professional, friendly, and concise.
    3. Never make up information.
    4. Only acknowledge previous responses in acknowledgment prompts; never combine acknowledgment with the next question.`;
    
    this.questionHistory = [
      this.getSystemMessage(systemMessageContent)
    ];
  }

  async getNextQuestion(): Promise<string> {
    const nextPlaceholder = this.getUnfilledPlaceholders()[0];

    if (!nextPlaceholder) {
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

    const messages = [
      ...this.questionHistory,
      this.getHumanMessage(prompt)
    ];

    const result = await this.model.invoke(messages);
    const question = this.extractTextContent(result as unknown as { content?: string | Array<unknown> | { text?: string }; [key: string]: unknown }) || "What should we fill in next?";
    
    this.questionHistory.push(this.getAIMessage(question));
    
    return question;
  }
  addAcknowledgment(acknowledgment: string): void {
    if (acknowledgment) {
      this.questionHistory.push(this.getAIMessage(acknowledgment));
    }
  }
  resetHistory(): void {
    const systemMessageContent = `You are a professional legal assistant helping a user fill out a ${this.session.fileName}.
    Guidelines:
    1. Ask about ONE placeholder at a time.
    2. Be professional, friendly, and concise.
    3. Never make up information.
    4. Only acknowledge previous responses in acknowledgment prompts; never combine acknowledgment with the next question.`;
    
    this.questionHistory = [
      this.getSystemMessage(systemMessageContent)
    ];
  }
}
