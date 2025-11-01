import { BaseAgent } from "./BaseAgent";
import { DocumentSession } from "../types";

export type QueryType = 
  | "answer"           // Direct answer to a question
  | "question"         // User asking about placeholders/document
  | "clarification"    // User needs clarification
  | "correction"       // User correcting a previous answer
  | "skip"             // User wants to skip the current placeholder and answer it later
  | "general";         // General conversation

export interface ClassificationResult {
  queryType: QueryType;
  confidence: number;
  reasoning?: string;
}

const ClassificationSchema = {
  type: "object" as const,
  description: "Classification of user query intent",
  properties: {
    queryType: {
      type: "string" as const,
      enum: ["answer", "question", "clarification", "correction", "skip", "general"],
      description: "The type of query from the user"
    },
    confidence: {
      type: "number" as const,
      description: "Confidence score between 0 and 1"
    },
    reasoning: {
      type: "string" as const,
      description: "Brief reasoning for the classification"
    }
  },
  required: ["queryType", "confidence"],
  name: "queryClassification"
};

export class ClassifierAgent extends BaseAgent {
  private structuredModel: Awaited<ReturnType<typeof this.getStructuredModel>>;

  constructor(session: DocumentSession) {
    super(session);
    this.structuredModel = this.getStructuredModel(ClassificationSchema) as Awaited<ReturnType<typeof this.getStructuredModel>>;
  }

  async classify(userMessage: string, context?: {
    lastQuestion?: string;
    filledPlaceholders?: string[];
  }): Promise<ClassificationResult> {
    const unfilledPlaceholders = this.getUnfilledPlaceholders();
    const filledPlaceholders = this.getFilledPlaceholders().map(p => p.key);

    const prompt = `Classify the user's message. Consider:
    - If they're directly answering a question about a placeholder: "answer"
    - If they're asking about the document, placeholders, or process: "question"
    - If they're confused or need help: "clarification"
    - If they're correcting a previous answer: "correction"
    - If they want to skip the current placeholder and answer it later (e.g., "skip", "pass", "I'll answer later", "let me answer this later", "not now", "later"): "skip"
    - If it's general conversation unrelated to filling the form: "general"

    Current context:
    - Unfilled placeholders: ${unfilledPlaceholders.length > 0 ? unfilledPlaceholders.map(p => p.label).join(", ") : "None"}
    - Filled placeholders: ${filledPlaceholders.length > 0 ? filledPlaceholders.join(", ") : "None"}
    ${context?.lastQuestion ? `- Last question asked: "${context.lastQuestion}"` : ""}

    User message: "${userMessage}"

    Classify this message.`;

    const result = await this.structuredModel.invoke([
      this.getHumanMessage(prompt)
    ]);

    const parsed = 'parsed' in result ? result.parsed : result;
    
    return {
      queryType: parsed.queryType || "answer",
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning
    };
  }
}
