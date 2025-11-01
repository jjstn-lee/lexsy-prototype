// lib/agents/DetectionAgent.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import { PlaceholderDetected } from '../types';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

export interface DetectionResult {
  placeholders: PlaceholderDetected[];
}

export class DetectionAgent {
  private model: ReturnType<typeof genAI.getGenerativeModel>;

  constructor() {
    this.model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash", 
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
      systemInstruction: "You are a legal document analyzer. Return only valid JSON. Always analyze the ENTIRE document thoroughly, including the last page."
    });
  }

  async detect(documentText: string): Promise<PlaceholderDetected[]> {
    console.log('[DetectionAgent] Starting placeholder detection');
    console.log('[DetectionAgent] Document text length:', documentText.length);
    console.log('[DetectionAgent] Document text preview (first 500 chars):', documentText.substring(0, 500));
    console.log('[DetectionAgent] Document text preview (last 500 chars):', documentText.substring(Math.max(0, documentText.length - 500)));
    
    const maxPromptLength = 30000;
    
    let placeholders: PlaceholderDetected[] = [];
    
    if (documentText.length <= maxPromptLength) {
      console.log('[DetectionAgent] Document fits in single pass, analyzing entire document');
      placeholders = await this.detectInChunk(documentText, 'full');
    } else {
      console.log('[DetectionAgent] Document too long, analyzing in chunks');
      placeholders = await this.detectInChunks(documentText, maxPromptLength);
    }
    const uniquePlaceholders = this.deduplicatePlaceholders(placeholders);
    console.log('[DetectionAgent] Final unique placeholders:', uniquePlaceholders.length);
    
    return uniquePlaceholders;
  }

  private async detectInChunk(text: string, chunkLabel: string): Promise<PlaceholderDetected[]> {
    console.log(`[DetectionAgent] Analyzing chunk "${chunkLabel}" (${text.length} chars)`);
    
    const prompt = `You are analyzing a legal document template to identify placeholders that need to be filled in.

    Document text:
    """
    ${text}
    """

    CRITICAL: Analyze the ENTIRE text provided above. Pay special attention to:
    - The BEGINNING of the document
    - The MIDDLE of the document  
    - The END of the document (this is often missed!)
    - Any placeholders near the end, especially on the last page

    Identify ALL placeholders, blanks, or fields that need to be filled. This includes:
    - Explicit placeholders like [___], {{name}}, [COMPANY NAME], [COMPANY], [name], [title]
    - Blank lines or underscores meant to be filled: ________ or long horizontal lines
    - Fields that say "insert X here" or similar
    - Standard legal document fields (party names, dates, amounts, signatures, addresses, emails, etc.)
    - Fields with labels followed by underscore lines (e.g., "Name:" followed by ________)
    - Signature lines with placeholders below them

    For each placeholder, provide:
    1. A unique key (lowercase, underscored, e.g., "investor_name", "company_signature_name")
    2. A user-friendly label (e.g., "Investor Name", "Company Signature Name")
    3. A brief description if needed
    4. The type: text, number, currency, date, email, address, or signature
    5. Whether it's required (true/false)
    6. The original text/pattern from the document (EXACTLY as it appears, including brackets, underscores, etc.)

    Return a JSON object with a "placeholders" array, no other text:
    {
      "placeholders": [
        {
          "key": "investor_name",
          "label": "Investor Name",
          "description": "Full legal name of the investing party",
          "type": "text",
          "required": true,
          "originalPattern": "[Investor Name]"
        }
      ]
    }`;

    console.log(`[DetectionAgent] Generated prompt for chunk "${chunkLabel}" (length: ${prompt.length})`);
    
    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const content = response.text();
      
      console.log(`[DetectionAgent] Response received for chunk "${chunkLabel}", length: ${content?.length || 0}`);
      console.log(`[DetectionAgent] Response preview (first 500 chars):`, content?.substring(0, 500) || 'null');
      
      if (!content) {
        console.warn(`[DetectionAgent] No content returned for chunk "${chunkLabel}"`);
        return [];
      }

      let jsonContent = content.trim();
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonContent);
      } catch (parseError) {
        console.warn(`[DetectionAgent] Initial JSON parse failed for chunk "${chunkLabel}", attempting sanitization`);
        const sanitized = this.sanitizeJsonString(jsonContent);
        
        try {
          parsed = JSON.parse(sanitized);
          console.log(`[DetectionAgent] Successfully parsed after sanitization`);
        } catch (secondError) {
          console.error(`[DetectionAgent] JSON parse error for chunk "${chunkLabel}":`, secondError);
          console.error(`[DetectionAgent] Original content (first 2000 chars):`, content.substring(0, 2000));
          console.error(`[DetectionAgent] Sanitized content (first 2000 chars):`, sanitized.substring(0, 2000));
          console.error(`[DetectionAgent] Error position info:`, parseError instanceof Error ? parseError.message : String(parseError));
          throw secondError;
        }
      }
      const chunkPlaceholders = Array.isArray(parsed) ? parsed : (parsed.placeholders || []);
      console.log(`[DetectionAgent] Found ${chunkPlaceholders.length} placeholders in chunk "${chunkLabel}"`);
      
      return chunkPlaceholders;
    } catch (error) {
      console.error(`[DetectionAgent] Error analyzing chunk "${chunkLabel}":`, error);
      console.error(`[DetectionAgent] Error details:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private sanitizeJsonString(jsonString: string): string {
    
    let result = '';
    let insideString = false;
    let escapeNext = false;
    
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      const code = char.charCodeAt(0);
      
      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        result += char;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        insideString = !insideString;
        result += char;
        continue;
      }
      
      if (insideString) {
        if (code >= 0x00 && code <= 0x1F) {
          if (code === 0x08) result += '\\b';
          else if (code === 0x09) result += '\\t';
          else if (code === 0x0A) result += '\\n';
          else if (code === 0x0D) result += '\\r';
          else if (code === 0x0C) result += '\\f';
          else {
            // Unicode escape for other control characters
            result += `\\u${code.toString(16).padStart(4, '0')}`;
          }
        } else if (code >= 0x7F && code <= 0x9F) {
          result += `\\u${code.toString(16).padStart(4, '0')}`;
        } else {
          result += char;
        }
      } else {
        if (code >= 0x00 && code <= 0x1F && code !== 0x09 && code !== 0x0A && code !== 0x0D) {
          result += ' ';
        } else {
          result += char;
        }
      }
    }
    
    return result;
  }

  private async detectInChunks(fullText: string, maxChunkSize: number): Promise<PlaceholderDetected[]> {
    const overlapSize = 2000;
    const chunks: Array<{ text: string; start: number; end: number; label: string }> = [];
    chunks.push({
      text: fullText.substring(0, maxChunkSize),
      start: 0,
      end: maxChunkSize,
      label: 'beginning'
    });
    let currentPos = maxChunkSize - overlapSize;
    let chunkIndex = 1;
    while (currentPos < fullText.length - maxChunkSize) {
      chunks.push({
        text: fullText.substring(currentPos, currentPos + maxChunkSize),
        start: currentPos,
        end: currentPos + maxChunkSize,
        label: `middle_${chunkIndex}`
      });
      currentPos += maxChunkSize - overlapSize;
      chunkIndex++;
    }
    
    // Last chunk - end of document
    const lastChunkStart = Math.max(0, fullText.length - maxChunkSize);
    chunks.push({
      text: fullText.substring(lastChunkStart),
      start: lastChunkStart,
      end: fullText.length,
      label: 'end'
    });
    
    console.log(`[DetectionAgent] Split document into ${chunks.length} chunks`);
    chunks.forEach(chunk => {
      console.log(`[DetectionAgent]   Chunk "${chunk.label}": ${chunk.start}-${chunk.end} (${chunk.text.length} chars)`);
    });
    const allPlaceholders: PlaceholderDetected[] = [];
    for (const chunk of chunks) {
      const chunkPlaceholders = await this.detectInChunk(chunk.text, chunk.label);
      allPlaceholders.push(...chunkPlaceholders);
    }
    
    return allPlaceholders;
  }

  private deduplicatePlaceholders(placeholders: PlaceholderDetected[]): PlaceholderDetected[] {
    const seen = new Map<string, PlaceholderDetected>();
    
    for (const placeholder of placeholders) {
      const existing = seen.get(placeholder.key);
      
      if (!existing) {
        seen.set(placeholder.key, placeholder);
      } else {
        if (!existing.originalPattern && placeholder.originalPattern) {
          seen.set(placeholder.key, placeholder);
        }
        else if (!existing.description && placeholder.description) {
          seen.set(placeholder.key, { ...existing, description: placeholder.description });
        }
      }
    }
    
    return Array.from(seen.values());
  }
}

