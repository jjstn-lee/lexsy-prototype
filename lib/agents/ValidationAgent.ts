import { BaseAgent } from "./BaseAgent";
import { DocumentSession } from "../types";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
}

const ValidationSchema = {
  type: "object" as const,
  description: "Validation result for extracted values",
  properties: {
    isValid: {
      type: "boolean" as const,
      description: "Whether the value is valid"
    },
    errors: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "List of validation errors"
    },
    warnings: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "List of validation warnings"
    },
    suggestions: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Optional suggestions for improvement"
    }
  },
  required: ["isValid", "errors", "warnings"],
  name: "validationResult"
};

export class ValidationAgent extends BaseAgent {
  private structuredModel: Awaited<ReturnType<typeof this.getStructuredModel>>;

  constructor(session: DocumentSession) {
    super(session);
    this.structuredModel = this.getStructuredModel(ValidationSchema) as Awaited<ReturnType<typeof this.getStructuredModel>>;
  }

  async validateValue(placeholderKey: string, value: string): Promise<ValidationResult> {
    const placeholder = this.session.placeholders.find(p => p.key === placeholderKey);
    
    if (!placeholder) {
      return {
        isValid: false,
        errors: ["Placeholder not found"],
        warnings: []
      };
    }

    // Basic type validation
    const basicValidation = this.validateType(placeholder.type, value);
    if (!basicValidation.isValid) {
      return basicValidation;
    }

    // LLM-based validation for more nuanced checks
    const prompt = `Validate this value for a document placeholder:

Placeholder: ${placeholder.label}
Type: ${placeholder.type}
${placeholder.description ? `Description: ${placeholder.description}` : ""}
Value to validate: "${value}"

Check:
1. Format correctness (dates, emails, etc.)
2. Reasonableness for the context
3. Completeness
4. Any obvious errors

Return validation result.`;

    try {
      const result = await this.structuredModel.invoke([
        this.getHumanMessage(prompt)
      ]);

      const parsed = 'parsed' in result ? result.parsed : result;
      
      return {
        isValid: parsed.isValid ?? true,
        errors: parsed.errors || [],
        warnings: parsed.warnings || [],
        suggestions: parsed.suggestions
      };
    } catch (error) {
      console.error('[ValidationAgent] Error during validation:', error);
      // Fallback to basic validation
      return basicValidation;
    }
  }

  private validateType(type: string, value: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (type) {
      case "email":
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          errors.push("Invalid email format");
        }
        break;

      case "date":
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          errors.push("Invalid date format");
        }
        break;

      case "number":
      case "currency":
        const numValue = parseFloat(value.replace(/[^0-9.-]/g, ""));
        if (isNaN(numValue)) {
          errors.push(`Invalid ${type} format`);
        }
        break;

      case "address":
        if (value.length < 10) {
          warnings.push("Address seems short - please include street, city, and state/zip");
        }
        break;

      case "text":
        if (!value.trim()) {
          errors.push("Value cannot be empty");
        }
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  async validateAll(): Promise<Record<string, ValidationResult>> {
    const results: Record<string, ValidationResult> = {};

    for (const placeholder of this.session.placeholders) {
      const value = this.session.responses[placeholder.key];
      if (value) {
        results[placeholder.key] = await this.validateValue(placeholder.key, value);
      }
    }

    return results;
  }
}
