// lib/generateDocx.ts

import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function generateFilledDocument(
  originalText: string,
  responses: Record<string, string>
): Promise<Buffer> {
  // Replace placeholders in text with responses
  let filledText = originalText;
  
  // Replace each placeholder key with its value
  for (const [key, value] of Object.entries(responses)) {
    // Try various placeholder patterns that might exist in the document
    const patterns = [
      new RegExp(`\\[${key}\\]`, 'gi'),
      new RegExp(`\\{\\{${key}\\}\\}`, 'gi'),
      new RegExp(`\\[${key.replace(/_/g, ' ').toUpperCase()}\\]`, 'gi'),
      new RegExp(`\\[${key.replace(/_/g, ' ')}\\]`, 'gi'),
    ];
    
    for (const pattern of patterns) {
      filledText = filledText.replace(pattern, value);
    }
  }

  // Split text into paragraphs (double newlines)
  const paragraphs = filledText
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((text) => {
      // Split by single newlines within paragraph
      const lines = text.split(/\n/);
      return new Paragraph({
        children: lines.flatMap((line, index) => {
          const trimmed = line.trim();
          if (trimmed.length === 0) {
            return [];
          }
          return [
            new TextRun({
              text: trimmed,
              break: index < lines.length - 1 ? 1 : 0,
            }),
          ];
        }),
      });
    });

  // If no paragraphs were created, create one with the full text
  if (paragraphs.length === 0) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: filledText,
          }),
        ],
      })
    );
  }

  // Create the document
  const doc = new Document({
    sections: [
      {
        children: paragraphs,
      },
    ],
  });

  // Generate the document buffer
  return await Packer.toBuffer(doc);
}

