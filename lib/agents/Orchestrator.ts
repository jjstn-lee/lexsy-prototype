import { DocumentSession } from "../types";
import { ClassifierAgent, QueryType } from "./ClassifierAgent";
import { QuestionAgent } from "./QuestionAgent";
import { ExtractionAgent } from "./ExtractionAgent";
import { ExplanationAgent } from "./ExplanationAgent";
import { ValidationAgent, ValidationResult } from "./ValidationAgent";

export interface OrchestratorResponse {
  message: string;
  isComplete: boolean;
  extractedValues?: Record<string, string>;
  needsClarification?: boolean;
  queryType?: QueryType;
}

export class Orchestrator {
  private session: DocumentSession;
  private classifier: ClassifierAgent;
  private questionAgent: QuestionAgent;
  private extractionAgent: ExtractionAgent;
  private explanationAgent: ExplanationAgent;
  private validationAgent: ValidationAgent;
  
  private lastQuestion?: string;
  private currentPlaceholderKey?: string;

  constructor(session: DocumentSession) {
    this.session = session;
    if (!this.session.skippedPlaceholders) {
      this.session.skippedPlaceholders = [];
    }
    this.classifier = new ClassifierAgent(session);
    this.questionAgent = new QuestionAgent(session);
    this.extractionAgent = new ExtractionAgent(session);
    this.explanationAgent = new ExplanationAgent(session);
    this.validationAgent = new ValidationAgent(session);
  }

  async processMessage(userMessage: string): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Processing message:', userMessage);

    const classification = await this.classifier.classify(userMessage, {
      lastQuestion: this.lastQuestion,
      filledPlaceholders: Object.keys(this.session.responses)
    });

    console.log('[Orchestrator] Classification:', classification);
    switch (classification.queryType) {
      case "answer":
        return await this.handleAnswer(userMessage, classification);
      
      case "question":
        return await this.handleQuestion(userMessage);
      
      case "clarification":
        return await this.handleClarification(userMessage);
      
      case "correction":
        return await this.handleCorrection(userMessage);
      
      case "skip":
        return await this.handleSkip(userMessage);
      
      case "general":
        return await this.handleGeneral(userMessage);
      
      default:
        return await this.handleAnswer(userMessage, classification);
    }
  }

  private async handleAnswer(
    userMessage: string, 
    classification: { queryType: QueryType; confidence: number }
  ): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Handling as answer');

    let placeholderForExtraction = this.currentPlaceholderKey;
    if (!placeholderForExtraction) {
      const unfilled = this.getUnfilledPlaceholders();
      placeholderForExtraction = unfilled[0]?.key;
    }
    const extractionResult = await this.extractionAgent.extract(userMessage, {
      lastQuestion: this.lastQuestion,
      currentPlaceholderKey: placeholderForExtraction
    });

    // Remove from skipped list if we just filled it
    for (const key of Object.keys(extractionResult.extractedValues)) {
      const index = this.session.skippedPlaceholders.indexOf(key);
      if (index > -1) {
        this.session.skippedPlaceholders.splice(index, 1);
      }
    }

    // Validate the extracted values
    const validationResults: Record<string, ValidationResult> = {};
    for (const [key, value] of Object.entries(extractionResult.extractedValues)) {
      validationResults[key] = await this.validationAgent.validateValue(key, value);
    }
    const hasErrors = Object.values(validationResults).some(
      (result) => !result.isValid
    );

    const isComplete = this.isComplete();

    // Strip any questions that might have been included
    let responseMessage = this.stripQuestionsFromAcknowledgment(extractionResult.response || "");
    if (hasErrors) {
      const errorMessages = Object.entries(validationResults)
        .filter(([, result]) => !result.isValid)
        .map(([key, result]) => 
          `${this.getPlaceholderLabel(key)}: ${result.errors.join(", ")}`
        );
      
      if (errorMessages.length > 0) {
        responseMessage += `\n\n⚠️ Please correct the following:\n${errorMessages.join("\n")}`;
      }
    }
    if (isComplete) {
      return {
        message: responseMessage + "\n\n✅ All information collected! Your document is ready.",
        isComplete: true,
        extractedValues: extractionResult.extractedValues
      };
    }

    const unfilledBefore = this.getUnfilledPlaceholders();
    
    // Get the next question
    const nextQuestion = await this.questionAgent.getNextQuestion();
    const nextPlaceholder = this.getUnfilledPlaceholders()[0];
    
    this.currentPlaceholderKey = nextPlaceholder?.key;
    this.lastQuestion = nextQuestion;
    if (extractionResult.understood && !extractionResult.needsClarification && extractionResult.response) {
      this.questionAgent.addAcknowledgment(extractionResult.response);
    }

    let finalMessage = "";
    if (extractionResult.understood && !extractionResult.needsClarification) {
      finalMessage = responseMessage 
        ? `${responseMessage}\n\n${nextQuestion}` 
        : nextQuestion;
    } else {
      const clarificationMessage = responseMessage || "I need a bit more information. Could you clarify?";
      finalMessage = `${clarificationMessage}\n\n${nextQuestion}`;
    }

    return {
      message: finalMessage,
      isComplete: false,
      extractedValues: extractionResult.extractedValues,
      needsClarification: extractionResult.needsClarification || !extractionResult.understood,
      queryType: classification.queryType
    };
  }

  private async handleQuestion(userMessage: string): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Handling as question');

    // Check if they're asking about the current placeholder
    const isAboutCurrentPlaceholder = this.lastQuestion && 
      (userMessage.toLowerCase().includes('what') || 
       userMessage.toLowerCase().includes('that') ||
       userMessage.toLowerCase().includes('this') ||
       userMessage.toLowerCase().includes('mean'));

    const explanation = await this.explanationAgent.explain(userMessage, {
      lastQuestion: this.lastQuestion,
      currentPlaceholderKey: this.currentPlaceholderKey,
      filledPlaceholders: Object.keys(this.session.responses)
    });

    const isComplete = this.isComplete();
    if (!isComplete) {
      // Re-ask the same question if they asked about it
      if (isAboutCurrentPlaceholder && this.lastQuestion) {
        return {
          message: `${explanation}\n\n${this.lastQuestion}`,
          isComplete: false,
          queryType: "question"
        };
      }
      
      // Move to next question
      const nextPlaceholder = this.getUnfilledPlaceholders()[0];
      this.currentPlaceholderKey = nextPlaceholder?.key;
      
      const nextQuestion = await this.questionAgent.getNextQuestion();
      this.lastQuestion = nextQuestion;
      
      return {
        message: `${explanation}\n\n${nextQuestion}`,
        isComplete: false,
        queryType: "question"
      };
    }

    return {
      message: explanation,
      isComplete: false,
      queryType: "question"
    };
  }

  private async handleClarification(userMessage: string): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Handling as clarification request');

    // Try extracting in case they're actually providing info
    const extractionResult = await this.extractionAgent.extract(userMessage, {
      lastQuestion: this.lastQuestion,
      currentPlaceholderKey: this.currentPlaceholderKey
    });
    
    const explanation = await this.explanationAgent.explain(userMessage, {
      lastQuestion: this.lastQuestion,
      currentPlaceholderKey: this.currentPlaceholderKey,
      filledPlaceholders: Object.keys(this.session.responses)
    });

    const hasExtracted = Object.keys(extractionResult.extractedValues).length > 0;

    if (hasExtracted && !extractionResult.needsClarification) {
      // They actually gave an answer, treat it as such
      return this.handleAnswer(userMessage, {
        queryType: "answer",
        confidence: 0.7
      });
    }

    // Re-ask the same question instead of moving forward
    const isComplete = this.isComplete();
    if (!isComplete) {
      // Re-ask the last question if we have one
      if (this.lastQuestion) {
        return {
          message: `${explanation}\n\n${this.lastQuestion}`,
          isComplete: false,
          needsClarification: true,
          queryType: "clarification"
        };
      }
      
      // No last question, get the next one
      const nextPlaceholder = this.getUnfilledPlaceholders()[0];
      this.currentPlaceholderKey = nextPlaceholder?.key;
      
      const nextQuestion = await this.questionAgent.getNextQuestion();
      this.lastQuestion = nextQuestion;
      
      return {
        message: `${explanation}\n\n${nextQuestion}`,
        isComplete: false,
        needsClarification: true,
        queryType: "clarification"
      };
    }

    return {
      message: explanation,
      isComplete: false,
      needsClarification: true,
      queryType: "clarification"
    };
  }

  private async handleCorrection(userMessage: string): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Handling as correction');
    const extractionResult = await this.extractionAgent.extract(userMessage, {
      lastQuestion: this.lastQuestion,
      currentPlaceholderKey: this.currentPlaceholderKey
    });

    // Remove from skipped list if we corrected it
    for (const key of Object.keys(extractionResult.extractedValues)) {
      const index = this.session.skippedPlaceholders.indexOf(key);
      if (index > -1) {
        this.session.skippedPlaceholders.splice(index, 1);
      }
    }

    const validationResults: Record<string, ValidationResult> = {};
    for (const [key, value] of Object.entries(extractionResult.extractedValues)) {
      validationResults[key] = await this.validationAgent.validateValue(key, value);
    }

    let responseMessage = extractionResult.response || "I've updated that information.";

    const hasErrors = Object.values(validationResults).some(
      (result) => !result.isValid
    );

    if (hasErrors) {
      const errorMessages = Object.entries(validationResults)
        .filter(([, result]) => !result.isValid)
        .map(([key, result]) => 
          `${this.getPlaceholderLabel(key)}: ${result.errors.join(", ")}`
        );
      
      responseMessage += `\n\n⚠️ Please correct the following:\n${errorMessages.join("\n")}`;
    }

    const isComplete = this.isComplete();
    if (!isComplete) {
      const nextPlaceholder = this.getUnfilledPlaceholders()[0];
      this.currentPlaceholderKey = nextPlaceholder?.key;
      
      const nextQuestion = await this.questionAgent.getNextQuestion();
      this.lastQuestion = nextQuestion;
      
      return {
        message: `${responseMessage}\n\n${nextQuestion}`,
        isComplete: false,
        extractedValues: extractionResult.extractedValues,
        queryType: "correction"
      };
    }

    return {
      message: responseMessage + "\n\n✅ All information collected! Your document is ready.",
      isComplete: true,
      extractedValues: extractionResult.extractedValues,
      queryType: "correction"
    };
  }

  private async handleGeneral(userMessage: string): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Handling as general conversation');

    // Check if they're agreeing to continue
    const normalizedMessage = userMessage.toLowerCase().trim();
    const isContinueRequest = /^(yes|yeah|yep|yup|sure|ok|okay|continue|let's go|let's continue)\b/i.test(normalizedMessage);

    // Move forward if they're continuing
    if (isContinueRequest) {
      const isComplete = this.isComplete();
      if (!isComplete) {
        const nextPlaceholder = this.getUnfilledPlaceholders()[0];
        this.currentPlaceholderKey = nextPlaceholder?.key;
        const nextQuestion = await this.questionAgent.getNextQuestion();
        this.lastQuestion = nextQuestion;
        
        return {
          message: nextQuestion,
          isComplete: false,
          queryType: "general"
        };
      }
    }

    const explanation = await this.explanationAgent.explain(userMessage, {
      lastQuestion: this.lastQuestion,
      currentPlaceholderKey: this.currentPlaceholderKey,
      filledPlaceholders: Object.keys(this.session.responses)
    });

    // Don't auto-ask next question, but offer to continue if incomplete
    const isComplete = this.isComplete();
    if (!isComplete && !isContinueRequest) {
      return {
        message: `${explanation}\n\nWould you like to continue filling out the document?`,
        isComplete: false,
        queryType: "general"
      };
    }

    return {
      message: explanation,
      isComplete: false,
      queryType: "general"
    };
  }

  private async handleSkip(userMessage: string): Promise<OrchestratorResponse> {
    console.log('[Orchestrator] Handling skip request');
    let placeholderToSkip = this.currentPlaceholderKey;
    if (!placeholderToSkip) {
      const unfilled = this.getUnfilledPlaceholders();
      placeholderToSkip = unfilled[0]?.key;
    }

    if (!placeholderToSkip) {
      // All placeholders are filled
      return {
        message: "All placeholders have been filled. There's nothing to skip.",
        isComplete: true,
        queryType: "general"
      };
    }

    // Mark as skipped if not already
    if (!this.session.skippedPlaceholders.includes(placeholderToSkip)) {
      this.session.skippedPlaceholders.push(placeholderToSkip);
    }

    const placeholderLabel = this.getPlaceholderLabel(placeholderToSkip);
    const skipMessage = `I've skipped "${placeholderLabel}" for now. We'll come back to it later.`;
    const isComplete = this.isComplete();
    if (isComplete) {
      // Return to skipped placeholders if any
      const skippedUnfilled = this.session.placeholders.filter(
        p => this.session.skippedPlaceholders.includes(p.key) && 
             !(this.session.responses[p.key]?.trim())
      );

      if (skippedUnfilled.length > 0) {
        const nextSkipped = skippedUnfilled[0];
        this.currentPlaceholderKey = nextSkipped.key;
        const nextQuestion = await this.questionAgent.getNextQuestion();
        this.lastQuestion = nextQuestion;
        
        return {
          message: `${skipMessage}\n\nNow let's finish the remaining fields:\n${nextQuestion}`,
          isComplete: false,
          queryType: "general"
        };
      }

      return {
        message: `${skipMessage}\n\n✅ All information collected! Your document is ready.`,
        isComplete: true,
        queryType: "general"
      };
    }
    const nextPlaceholder = this.getUnfilledPlaceholders()[0];
    this.currentPlaceholderKey = nextPlaceholder?.key;
    const nextQuestion = await this.questionAgent.getNextQuestion();
    this.lastQuestion = nextQuestion;

    return {
      message: `${skipMessage}\n\n${nextQuestion}`,
      isComplete: false,
      queryType: "general"
    };
  }

  // Helper methods
  private isComplete(): boolean {
    return this.session.placeholders.every(
      p => this.session.responses[p.key]?.trim()
    );
  }

  private getUnfilledPlaceholders() {
    const unfilled = this.session.placeholders.filter(
      p => !(this.session.responses[p.key]?.trim())
    );
    
    // Put skipped ones last
    const skipped = unfilled.filter(
      p => this.session.skippedPlaceholders.includes(p.key)
    );
    const notSkipped = unfilled.filter(
      p => !this.session.skippedPlaceholders.includes(p.key)
    );
    
    return [...notSkipped, ...skipped];
  }

  private getPlaceholderLabel(key: string): string {
    const placeholder = this.session.placeholders.find(p => p.key === key);
    return placeholder?.label || key;
  }
  private stripQuestionsFromAcknowledgment(text: string): string {
    if (!text) return text;
    const questionIndex = text.indexOf('?');
    
    if (questionIndex === -1) {
      return text.trim();
    }
    let cleaned = text.substring(0, questionIndex).trim();
    const beforeQuestion = text.substring(0, questionIndex);
    const questionWordPattern = /\b(what|which|who|where|when|why|how|is|are|can|will|would|should|do|does|did)\b/i;
    const lastPeriod = beforeQuestion.lastIndexOf('.');
    const lastExclamation = beforeQuestion.lastIndexOf('!');
    const lastBoundary = Math.max(lastPeriod, lastExclamation);
    
    if (lastBoundary > 0) {
      const afterBoundary = beforeQuestion.substring(lastBoundary + 1).trim();
      if (questionWordPattern.test(afterBoundary)) {
        cleaned = beforeQuestion.substring(0, lastBoundary + 1).trim();
      } else {
        cleaned = beforeQuestion.trim();
      }
    } else if (questionWordPattern.test(beforeQuestion.trim())) {
      cleaned = "";
    }
    if (cleaned.length > 0) {
      const lastChar = cleaned[cleaned.length - 1];
      if (!/[.!]$/.test(lastChar)) {
        cleaned += ".";
      }
    }
    return cleaned || "I've noted that.";
  }
}
