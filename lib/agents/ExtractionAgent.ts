import { BaseAgent } from "./BaseAgent";
import { DocumentSession } from "../types";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

export interface ExtractionResult {
  understood: boolean;
  extractedValues: Record<string, string>;
  response?: string;
  needsClarification: boolean;
}

const PlaceholderResponseSchema = {
  type: "object" as const,
  description: "Structured response for extracted placeholders. If the user provides a simple value after being asked a specific question, map it to that question's placeholder.",
  properties: {
    understood: { 
      type: "boolean" as const, 
      description: "Whether the user's message was understood" 
    },
    extractedValues: {
      type: "array" as const,
      description: "Array of key-value pairs mapping placeholder IDs to values. PRESERVE EXACT USER INPUT including symbols like $, %, commas, etc.",
      items: {
        type: "object" as const,
        properties: {
          key: { 
            type: "string" as const, 
            description: "The placeholder ID" 
          },
          value: { 
            type: "string" as const, 
            description: "The EXACT extracted value AS THE USER TYPED IT. Do not remove currency symbols ($), percent signs (%), commas, or any formatting. Preserve the original string exactly." 
          }
        },
        required: ["key", "value"]
      }
    },
    response: { 
      type: "string" as const, 
      description: "Concise acknowledgment of the user's message. Do NOT ask any questions. Only acknowledge (e.g., 'I've noted that.', 'Got it.', 'Thank you.'). No questions should be included." 
    },
    needsClarification: { 
      type: "boolean" as const, 
      description: "Whether clarification is needed" 
    }
  },
  required: ["understood", "extractedValues", "response", "needsClarification"],
  name: "placeholderResponse"
};

export class ExtractionAgent extends BaseAgent {
  private extractionHistory: (HumanMessage | AIMessage)[];
  private structuredModel: Awaited<ReturnType<typeof this.getStructuredModel>>;

  private synonymMap: Record<string, string> = {
    "company": "company_name",
    "company_name": "company_name",
    "founder_name": "founder",
    "founder": "founder",
  };

  constructor(session: DocumentSession) {
    super(session);
    this.extractionHistory = [];
    this.structuredModel = this.getStructuredModel(PlaceholderResponseSchema) as Awaited<ReturnType<typeof this.getStructuredModel>>;
  }

  async extract(userMessage: string, context?: {
    lastQuestion?: string;
    currentPlaceholderKey?: string;
  }): Promise<ExtractionResult> {
    const unfilledPlaceholders = this.getUnfilledPlaceholders();

    const getPlaceholderLabel = (key: string): string => {
      const placeholder = this.session.placeholders.find(p => p.key === key);
      return placeholder?.label || key;
    };

    let contextInfo = "";
    if (context?.lastQuestion) {
      contextInfo += `\nIMPORTANT: The last question asked was: "${context.lastQuestion}"\n`;
      contextInfo += `If the user provides a simple value in response to this question, it almost certainly refers to the placeholder mentioned in that question.\n`;
    }
    if (context?.currentPlaceholderKey) {
      const currentLabel = getPlaceholderLabel(context.currentPlaceholderKey);
      contextInfo += `\nWe are currently working on: "${currentLabel}" (key: ${context.currentPlaceholderKey})\n`;
      contextInfo += `If the user provides a value, prioritize mapping it to this placeholder.\n`;
    }

    const extractionPrompt = `
    Analyze the user's response and extract values ONLY for unfilled placeholders.
    Do NOT ask new questions or combine acknowledgment with other instructions.

    Extract values EXACTLY as the user typed them. Do not:
    - Remove currency symbols like $ or € 
    - Remove percent signs like %
    - Remove commas from numbers
    - Reformat dates
    
    You may ONLY do the following:
    - Simple spelling corrections (e.g., "partnrs" -> "partners", "recieve" -> "receive")
    - Trim leading/trailing whitespace
    - Normalize internal whitespace (multiple spaces -> single space)
    - Capitalize proper nouns if clearly names (e.g., "john smith" -> "John Smith")
    - Standardize date formats to YYYY-MM-DD if user provides a date (e.g., "12/25/2024" -> "2024-12-25")
    - Convert written numbers to digits for quantities (e.g., "five thousand" -> "5000", "twenty percent" -> "20%")
    - Add "%" if user says "20 percent" but not if they say "$20"
    - Remove currency words but keep symbols (e.g., "50 dollars" -> "$50", but "$50" stays "$50")
    
    ${contextInfo}
    
    Unfilled placeholders:
    ${JSON.stringify(unfilledPlaceholders, null, 2)}
    
    User said: "${userMessage}"
    
    Extract the value and map it to the appropriate placeholder. If a question was just asked about a specific placeholder, prioritize mapping to that placeholder.
    `;

    this.extractionHistory.push(this.getHumanMessage(userMessage));

    const messages = [
      ...this.extractionHistory,
      this.getHumanMessage(extractionPrompt)
    ];

    const result = await this.structuredModel.invoke(messages);
    const parsed = 'parsed' in result ? result.parsed : result;
    
    const parsedResult = parsed as {
      understood?: boolean;
      extractedValues?: Array<{ key: string; value: string }> | Record<string, string>;
      response?: string;
      needsClarification?: boolean;
    };

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

    // Map to correct placeholder keys
    const mappedValues = this.mapToPlaceholderKeys(
      extractedValuesRecord,
      context?.currentPlaceholderKey
    );
    
    // Only update with new values
    const newKeys = Object.keys(mappedValues).filter(
      k => !(this.session.responses[k]?.trim())
    );

    if (newKeys.length > 0) {
      for (const key of newKeys) {
        this.session.responses[key] = mappedValues[key];
      }
      if (parsedResult.response) {
        this.extractionHistory.push(this.getAIMessage(parsedResult.response));
      }
    }

    return {
      understood: parsedResult.understood ?? false,
      extractedValues: mappedValues,
      response: parsedResult.response,
      needsClarification: parsedResult.needsClarification ?? false
    };
  }

  private mapToPlaceholderKeys(
    extractedValues: Record<string, string>,
    preferredPlaceholderKey?: string
  ): Record<string, string> {
    const mapped: Record<string, string> = {};

    for (const [key, value] of Object.entries(extractedValues)) {
      const lowerKey = key.toLowerCase().trim();
      const mappedKey = this.synonymMap[lowerKey] ?? lowerKey.replace(/\s+/g, "_");
      if (preferredPlaceholderKey) {
        const preferredPlaceholder = this.session.placeholders.find(
          p => p.key === preferredPlaceholderKey
        );
        
        if (preferredPlaceholder) {
          const preferredKeyNormalized = preferredPlaceholder.key.toLowerCase().replace(/\s+/g, "_");
          const preferredLabelNormalized = preferredPlaceholder.label.toLowerCase().replace(/\s+/g, "_");
          if (
            mappedKey === preferredKeyNormalized || 
            mappedKey === preferredLabelNormalized ||
            preferredPlaceholder.label.toLowerCase().includes(mappedKey) ||
            mappedKey.includes(preferredKeyNormalized) ||
            mappedKey.includes(preferredLabelNormalized)
          ) {
            mapped[preferredPlaceholder.key] = value;
            continue;
          }
        }
      }

      const matchingPlaceholder = this.session.placeholders.find(p => {
        if (!p || !p.key || !p.label) return false;

        const normalizedKeyField = p.key.toLowerCase().replace(/\s+/g, "_");
        const normalizedLabel = p.label.toLowerCase().replace(/\s+/g, "_");

        return mappedKey === normalizedKeyField || mappedKey === normalizedLabel;
      });

      if (matchingPlaceholder) {
        mapped[matchingPlaceholder.key] = value;
      } else {
        mapped[key] = value;
      }
    }

    return mapped;
  }

  resetHistory(): void {
    this.extractionHistory = [];
  }
}
