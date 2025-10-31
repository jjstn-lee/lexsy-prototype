// lib/detectPlaceholders.ts

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

export async function detectPlaceholders(documentText: string) {
  console.log('[detectPlaceholders] Starting placeholder detection');
  console.log('[detectPlaceholders] Document text length:', documentText.length);
  console.log('[detectPlaceholders] Document text preview (first 500 chars):', documentText.substring(0, 500));
  
  const truncatedText = documentText.substring(0, 4000);
  console.log('[detectPlaceholders] Truncated text length:', truncatedText.length);
  
  const prompt = `You are analyzing a legal document template to identify placeholders that need to be filled in.

Document text:
"""
${truncatedText}
"""

Identify ALL placeholders, blanks, or fields that need to be filled. This includes:
- Explicit placeholders like [___], {{name}}, [COMPANY NAME]
- Blank lines or underscores meant to be filled: ________
- Fields that say "insert X here" or similar
- Standard legal document fields (party names, dates, amounts, etc.)

For each placeholder, provide:
1. A unique key (lowercase, underscored, e.g., "investor_name")
2. A user-friendly label (e.g., "Investor Name")
3. A brief description if needed
4. The type: text, number, currency, date, email, or address
5. Whether it's required (true/false)
6. The original text/pattern from the document

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

  console.log('[detectPlaceholders] Generated prompt (length:', prompt.length, ')');
  console.log('[detectPlaceholders] Prompt preview (first 300 chars):', prompt.substring(0, 300));
  
  console.log('[detectPlaceholders] Creating GenerativeModel with config:', {
    model: "gemini-2.5-flash",
    temperature: 0.3,
    responseMimeType: "application/json",
    hasApiKey: !!process.env.GOOGLE_AI_API_KEY
  });

  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
    systemInstruction: "You are a legal document analyzer. Return only valid JSON."
  });

  console.log('[detectPlaceholders] Model created, calling generateContent...');
  
  const result = await model.generateContent(prompt);
  
  console.log('[detectPlaceholders] generateContent completed');
  console.log('[detectPlaceholders] Result object keys:', Object.keys(result));
  
  const response = result.response;
  console.log('[detectPlaceholders] Response object:', response);
  
  const content = response.text();
  console.log('[detectPlaceholders] Extracted text content length:', content?.length || 0);
  console.log('[detectPlaceholders] Raw content preview (first 500 chars):', content?.substring(0, 500) || 'null');

  if (!content) {
    console.log('[detectPlaceholders] No content returned, returning empty array');
    return [];
  }

  try {
    console.log('[detectPlaceholders] Attempting to parse JSON...');
    const parsed = JSON.parse(content);
    console.log('[detectPlaceholders] JSON parsed successfully');
    console.log('[detectPlaceholders] Parsed result type:', Array.isArray(parsed) ? 'array' : 'object');
    console.log('[detectPlaceholders] Parsed result:', JSON.stringify(parsed, null, 2));
    
    // handle both { placeholders: [...] } and direct array
    if (Array.isArray(parsed)) {
      console.log('[detectPlaceholders] Result is direct array, returning:', parsed.length, 'placeholders');
      return parsed;
    }
    
    const placeholders = parsed.placeholders || [];
    console.log('[detectPlaceholders] Extracted placeholders from object:', placeholders.length, 'placeholders');
    console.log('[detectPlaceholders] Placeholders:', JSON.stringify(placeholders, null, 2));
    return placeholders;
  } catch (error) {
    console.error('[detectPlaceholders] Failed to parse placeholder detection response:', error);
    console.error('[detectPlaceholders] Error details:', error instanceof Error ? error.message : String(error));
    console.error('[detectPlaceholders] Content that failed to parse:', content);
    return [];
  }
}