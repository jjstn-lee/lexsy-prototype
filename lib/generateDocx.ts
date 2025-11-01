// lib/generateDocx.ts

import mammoth from 'mammoth';
import { PlaceholderDetected } from './types';
import PizZip from 'pizzip';

/**
 * Escape special regex characters in a string for use in a regex pattern
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createPlaceholderPatterns(originalPattern: string): RegExp[] {
  const patterns: RegExp[] = [];
  
  patterns.push(new RegExp(escapeRegex(originalPattern), 'gi'));
  
  console.log(`[generateDocx]     Created ${patterns.length} pattern(s) for "${originalPattern.substring(0, 50)}"`);
  return patterns;
}

export async function generateFilledDocument(
  originalBuffer: Buffer,
  responses: Record<string, string>,
  placeholders: PlaceholderDetected[],
  fallbackText?: string
): Promise<Buffer> {
  try {
    console.log('[generateDocx] ========================================');
    console.log('[generateDocx] Starting DOCX XML manipulation approach...');
    console.log('[generateDocx] Input buffer size:', originalBuffer.length, 'bytes');
    console.log('[generateDocx] Number of placeholders:', placeholders.length);
    console.log('[generateDocx] Number of responses:', Object.keys(responses).length);
    console.log('[generateDocx] Responses:', JSON.stringify(responses, null, 2));
    console.log('[generateDocx] Placeholders:', JSON.stringify(placeholders.map(p => ({ key: p.key, label: p.label, pattern: p.originalPattern })), null, 2));
    
    console.log('[generateDocx] Step 1: Loading DOCX as ZIP archive...');
    const zip = new PizZip(originalBuffer);
    const fileNames = Object.keys(zip.files);
    console.log('[generateDocx] ZIP files found:', fileNames.length);
    console.log('[generateDocx] Key files:', fileNames.filter(f => f.startsWith('word/')).slice(0, 10));
    
    console.log('[generateDocx] Step 2: Extracting word/document.xml...');
    let documentXml = zip.files['word/document.xml'];
    if (!documentXml) {
      console.error('[generateDocx] ERROR: Could not find word/document.xml in ZIP');
      console.error('[generateDocx] Available files:', fileNames);
      throw new Error('Could not find word/document.xml in DOCX file');
    }
    
    let xmlContent = documentXml.asText();
    console.log('[generateDocx] Loaded document.xml, length:', xmlContent.length, 'characters');
    console.log('[generateDocx] First 500 chars of XML:', xmlContent.substring(0, 500));
    
    console.log('[generateDocx] Step 3: Replacing placeholders in XML...');
    console.log('[generateDocx] ========================================');
    
    const responseMap = new Map<string, string>();
  for (const [key, value] of Object.entries(responses)) {
      responseMap.set(key, value);
      console.log(`[generateDocx] Mapped response: "${key}" = "${value}"`);
    }
    let totalReplacements = 0;
    const replacementLog: string[] = [];
    console.log('[generateDocx] Starting replacement loop for', placeholders.length, 'placeholders...');
    for (let pIdx = 0; pIdx < placeholders.length; pIdx++) {
      const placeholder = placeholders[pIdx];
      console.log(`[generateDocx] --- Processing placeholder ${pIdx + 1}/${placeholders.length} ---`);
      console.log(`[generateDocx] Placeholder key: "${placeholder.key}"`);
      console.log(`[generateDocx] Placeholder label: "${placeholder.label}"`);
      console.log(`[generateDocx] Placeholder originalPattern: "${placeholder.originalPattern}"`);
      
      const value = responseMap.get(placeholder.key);
      if (!value) {
        console.warn(`[generateDocx] ⚠️  No response found for placeholder: ${placeholder.key}`);
        console.warn(`[generateDocx] Available keys in responseMap:`, Array.from(responseMap.keys()));
        continue;
      }

      console.log(`[generateDocx] Found response value: "${value}"`);
      
      // Escape the value for XML
      const escapedValue = escapeXml(value);
      console.log(`[generateDocx] Escaped value: "${escapedValue}"`);
      
      const patternsToTry: Array<{ pattern: string; regex: RegExp; type: string }> = [];
      
      if (placeholder.originalPattern) {
        patternsToTry.push({
          pattern: placeholder.originalPattern,
          regex: new RegExp(escapeRegex(placeholder.originalPattern), 'gi'),
          type: 'originalPattern_exact'
        });
        console.log(`[generateDocx]     Using originalPattern: "${placeholder.originalPattern}"`);
      }
      if (!placeholder.originalPattern) {
        console.log(`[generateDocx]     No originalPattern, trying fallback patterns...`);
        const searchPatterns = [
          `[${placeholder.label}]`,
          `{{${placeholder.label}}}`,
          `[${placeholder.key}]`,
          `{{${placeholder.key}}}`,
        ];
        
        // Try with underscores replaced by spaces
        const spacedKey = placeholder.key.replace(/_/g, ' ');
        searchPatterns.push(
          `[${spacedKey}]`,
          `[${spacedKey.toUpperCase()}]`
        );
        
        searchPatterns.forEach(pattern => {
          patternsToTry.push({
            pattern,
            regex: new RegExp(escapeRegex(pattern), 'gi'),
            type: `fallback_${pattern.substring(0, 20)}`
          });
        });
      }

      let replaced = false;
      let replacementCount = 0;
      let matchedType = '';
      
      const textNodeRegex = /<w:t[^>]*>([^<]*)<\/w:t>/gi;
      let textNodeMatch: RegExpExecArray | null;
      
      console.log(`[generateDocx] Trying ${patternsToTry.length} pattern variations...`);
      
      for (let patternIdx = 0; patternIdx < patternsToTry.length; patternIdx++) {
        const { pattern, regex, type } = patternsToTry[patternIdx];
        console.log(`[generateDocx]   Pattern ${patternIdx + 1}/${patternsToTry.length}: type="${type}", pattern="${pattern.substring(0, 50)}"`);
        let foundMatches = 0;
        const replacements: Array<{ start: number; end: number; replacement: string; originalText: string }> = [];
        textNodeRegex.lastIndex = 0;
        const allTextNodes = [];
        while ((textNodeMatch = textNodeRegex.exec(xmlContent)) !== null) {
          allTextNodes.push({ index: textNodeMatch.index, text: textNodeMatch[1] });
        }
        console.log(`[generateDocx]   Found ${allTextNodes.length} total <w:t> nodes in document`);
        textNodeRegex.lastIndex = 0;
        let checkedNodes = 0;
        let nodesWithSpecialChars = 0;
        
        while ((textNodeMatch = textNodeRegex.exec(xmlContent)) !== null) {
          checkedNodes++;
          const textContent = textNodeMatch[1];
          const fullMatch = textNodeMatch[0];
          const matchIndex = textNodeMatch.index;
          if (textContent.includes('[') || textContent.includes('$') || textContent.includes('_') || textContent.includes('{')) {
            nodesWithSpecialChars++;
            if (nodesWithSpecialChars <= 10) {
              console.log(`[generateDocx]     Text node ${checkedNodes} (has special chars): content="${textContent.substring(0, 80)}"`);
            }
          }
          
          if (checkedNodes <= 5 && textContent.length > 0) {
            console.log(`[generateDocx]     Text node ${checkedNodes}: content="${textContent.substring(0, 50)}"`);
          }
          
          // Check if this text node contains our pattern
          // Create a new regex instance to avoid lastIndex issues
          const testRegex = new RegExp(regex.source, regex.flags);
          const patternMatches = testRegex.test(textContent);
          
          if (patternMatches) {
            console.log(`[generateDocx]     ✓ Pattern matches in text node ${checkedNodes}: "${textContent.substring(0, 100)}"`);
            
            // Make sure replacement value doesn't match the pattern (avoid infinite loops)
            const valueMatchesPattern = testRegex.test(escapedValue);
            if (valueMatchesPattern) {
              console.error(`[generateDocx]     ⚠️  ERROR: Replacement value "${escapedValue.substring(0, 50)}" matches the pattern! This will cause infinite recursion. Skipping.`);
              continue;
            }
            const replaceRegex = new RegExp(regex.source, regex.flags);
            const allMatches = textContent.match(replaceRegex);
            const matchCount = allMatches ? allMatches.length : 0;
            console.log(`[generateDocx]     Pattern appears ${matchCount} time(s) in this text node`);
            const replacedText = textContent.replace(replaceRegex, escapedValue);
            
            console.log(`[generateDocx]     Original text length: ${textContent.length}, replaced length: ${replacedText.length}`);
            console.log(`[generateDocx]     Original text: "${textContent.substring(0, 200)}"`);
            console.log(`[generateDocx]     Replaced text: "${replacedText.substring(0, 200)}"`);
            if (replacedText.length > textContent.length * 3) {
              console.error(`[generateDocx]     ⚠️  WARNING: Replacement increased text size by ${(replacedText.length / textContent.length).toFixed(1)}x!`);
              console.error(`[generateDocx]     Original: ${textContent.length} chars, Replaced: ${replacedText.length} chars`);
              console.error(`[generateDocx]     This might indicate the pattern matched too much. Skipping this replacement.`);
              continue;
            }
            const openingTag = fullMatch.match(/<w:t[^>]*>/)?.[0] || '<w:t>';
            const replacement = openingTag + replacedText + '</w:t>';
            console.log(`[generateDocx]     Replacement XML length: ${replacement.length}`);
            
            replacements.push({
              start: matchIndex,
              end: matchIndex + fullMatch.length,
              replacement,
              originalText: textContent
            });
            
            foundMatches += matchCount; // Count actual matches, not just nodes
          }
        }
        
        console.log(`[generateDocx]   Pattern "${type}": checked ${checkedNodes} nodes, found ${foundMatches} matches`);
        
        if (replacements.length > 0) {
          console.log(`[generateDocx]   ✓ Success! Applying ${replacements.length} replacement(s)...`);
          
          // Apply from end to start to preserve indices
          for (let i = replacements.length - 1; i >= 0; i--) {
            const { start, end, replacement, originalText } = replacements[i];
            const beforeLength = xmlContent.length;
            xmlContent = xmlContent.substring(0, start) + replacement + xmlContent.substring(end);
            const afterLength = xmlContent.length;
            console.log(`[generateDocx]     Replacement ${i + 1}: position ${start}-${end}, length ${beforeLength} -> ${afterLength}`);
            console.log(`[generateDocx]       Original: "${originalText.substring(0, 50)}"`);
            console.log(`[generateDocx]       New: "${replacement.substring(0, 100)}"`);
          }
          
          replacementCount = foundMatches;
          replaced = true;
          matchedType = type;
          console.log(`[generateDocx]   ✓ Pattern "${type}" successfully replaced ${foundMatches} occurrence(s)`);
          break;
        } else {
          console.log(`[generateDocx]   ✗ Pattern "${type}" did not match any text nodes`);
        }
      }
      
      // Try matching across split text nodes if no match found
      if (!replaced && placeholder.originalPattern) {
        console.log(`[generateDocx]   Trying split-node matching for pattern: "${placeholder.originalPattern}"`);
        textNodeRegex.lastIndex = 0;
        const allTextNodes: Array<{ index: number; start: number; end: number; text: string; fullMatch: string }> = [];
        while ((textNodeMatch = textNodeRegex.exec(xmlContent)) !== null) {
          allTextNodes.push({
            index: allTextNodes.length,
            start: textNodeMatch.index,
            end: textNodeMatch.index + textNodeMatch[0].length,
            text: textNodeMatch[1],
            fullMatch: textNodeMatch[0]
          });
        }
        
        // Try to find the pattern split across adjacent nodes
        // Look for nodes that start with the beginning of the pattern
        const patternStart = placeholder.originalPattern.substring(0, Math.min(10, placeholder.originalPattern.length));
        const patternEnd = placeholder.originalPattern.substring(Math.max(0, placeholder.originalPattern.length - 10));
        
        console.log(`[generateDocx]   Looking for split pattern: start="${patternStart}", end="${patternEnd}"`);
        
        for (let i = 0; i < allTextNodes.length; i++) {
          const node = allTextNodes[i];
          if (node.text.includes(patternStart) || node.text.startsWith(patternStart.charAt(0))) {
            let reconstructedText = node.text;
            let lastNodeIndex = i;
            const maxLookahead = 5;
            
            for (let j = i + 1; j < Math.min(i + maxLookahead, allTextNodes.length); j++) {
              const nextNode = allTextNodes[j];
              reconstructedText += nextNode.text;
              lastNodeIndex = j;
              if (reconstructedText.includes(placeholder.originalPattern)) {
                console.log(`[generateDocx]   ✓ Found split pattern across nodes ${i}-${lastNodeIndex}`);
                console.log(`[generateDocx]   Reconstructed text: "${reconstructedText.substring(0, 100)}"`);
                const replaceRegex = new RegExp(escapeRegex(placeholder.originalPattern), 'gi');
                const replacedText = reconstructedText.replace(replaceRegex, escapedValue);
                
                if (replacedText !== reconstructedText) {
                  console.log(`[generateDocx]   Replaced text: "${replacedText.substring(0, 100)}"`);
                  
                  // Replace across multiple nodes
                  const firstNode = allTextNodes[i];
                  const lastNode = allTextNodes[lastNodeIndex];
                  const patternStartPos = replacedText.indexOf(escapedValue);
                  const patternEndPos = patternStartPos + escapedValue.length;
                  const openingTag = firstNode.fullMatch.match(/<w:t[^>]*>/)?.[0] || '<w:t>';
                  
                  // Replace the entire span from first node start to last node end
                  const replacement = openingTag + escapedValue + '</w:t>';
                  const spanStart = firstNode.start;
                  const spanEnd = lastNode.end;
                  
                  xmlContent = xmlContent.substring(0, spanStart) + replacement + xmlContent.substring(spanEnd);
                  
                  replacementCount = 1;
                  replaced = true;
                  matchedType = 'split_across_nodes';
                  console.log(`[generateDocx]   ✓ Successfully replaced split pattern across nodes ${i}-${lastNodeIndex}`);
                  break;
                }
              }
              
              if (reconstructedText.length > placeholder.originalPattern.length * 3) {
                break;
              }
            }
            
            if (replaced) break;
          }
        }
      }
      
      if (replaced) {
        totalReplacements += replacementCount;
        replacementLog.push(`✓ ${placeholder.key}: ${replacementCount} replacement(s) via "${matchedType}"`);
        console.log(`[generateDocx] ✓ Successfully replaced placeholder "${placeholder.key}"`);
      } else {
        console.warn(`[generateDocx] ✗ FAILED: Could not find any pattern for placeholder: ${placeholder.key}`);
        console.warn(`[generateDocx]   Label: "${placeholder.label}"`);
        console.warn(`[generateDocx]   OriginalPattern: "${placeholder.originalPattern}"`);
        console.warn(`[generateDocx]   Tried ${patternsToTry.length} pattern variations`);
        console.warn(`[generateDocx]   Searching for text nodes with similar characters...`);
        const debugTextNodeRegex = /<w:t[^>]*>([^<]*)<\/w:t>/gi;
        const candidateNodes: Array<{ text: string; snippet: string }> = [];
        let nodeCheckCount = 0;
        debugTextNodeRegex.lastIndex = 0;
        
        let debugTextNodeMatch: RegExpExecArray | null;
        while (nodeCheckCount < 100 && (debugTextNodeMatch = debugTextNodeRegex.exec(xmlContent)) !== null) {
          nodeCheckCount++;
          const textContent = debugTextNodeMatch[1];
          if (textContent.includes('[') || textContent.includes('$') || textContent.includes('_')) {
            candidateNodes.push({
              text: textContent,
              snippet: textContent.substring(0, 100)
            });
            if (candidateNodes.length >= 10) break;
          }
        }
        
        if (candidateNodes.length > 0) {
          console.warn(`[generateDocx]   Found ${candidateNodes.length} text node(s) with placeholder-like characters:`);
          candidateNodes.forEach((node, idx) => {
            console.warn(`[generateDocx]     ${idx + 1}. "${node.snippet}"`);
          });
        } else {
          console.warn(`[generateDocx]   No text nodes found with bracket/dollar/underscore characters`);
        }
        
        // Also check if pattern might be split across nodes
        if (placeholder.originalPattern) {
          const patternChars = placeholder.originalPattern.split('');
          const firstChar = patternChars[0];
          const lastChar = patternChars[patternChars.length - 1];
          console.warn(`[generateDocx]   Pattern starts with: "${firstChar}", ends with: "${lastChar}"`);
          console.warn(`[generateDocx]   Checking if pattern might be split across multiple <w:t> nodes...`);
          debugTextNodeRegex.lastIndex = 0;
          nodeCheckCount = 0;
          let splitCandidates = 0;
          while (nodeCheckCount < 200 && (debugTextNodeMatch = debugTextNodeRegex.exec(xmlContent)) !== null) {
            nodeCheckCount++;
            const textContent = debugTextNodeMatch[1];
            if (textContent.includes(firstChar) || textContent.includes(lastChar)) {
              splitCandidates++;
              if (splitCandidates <= 5) {
                console.warn(`[generateDocx]     Candidate split node: "${textContent.substring(0, 50)}"`);
              }
            }
          }
          console.warn(`[generateDocx]   Found ${splitCandidates} nodes with pattern boundary characters`);
        }
        
        replacementLog.push(`✗ ${placeholder.key}: NO MATCH found (pattern: "${placeholder.originalPattern || placeholder.label}")`);
      }
      console.log(`[generateDocx] --- End placeholder ${pIdx + 1} ---`);
    }

    console.log('[generateDocx] ========================================');
    console.log('[generateDocx] Replacement summary:');
    replacementLog.forEach(log => console.log(`[generateDocx]   ${log}`));
    console.log(`[generateDocx] Total replacements: ${totalReplacements}`);
    console.log(`[generateDocx] XML content length after replacements: ${xmlContent.length} characters`);

    // Step 4: Validate XML before updating
    console.log('[generateDocx] Step 4: Validating XML structure...');
    // Basic validation: check for balanced tags
    const openTags = (xmlContent.match(/<[^/][^>]*>/g) || []).length;
    const closeTags = (xmlContent.match(/<\/[^>]+>/g) || []).length;
    console.log(`[generateDocx] XML tag counts: ${openTags} opening tags, ${closeTags} closing tags`);
    
    if (Math.abs(openTags - closeTags) > 0) {
      console.warn(`[generateDocx] ⚠️  XML tag imbalance detected: ${openTags} opening tags vs ${closeTags} closing tags`);
      console.warn(`[generateDocx] Difference: ${Math.abs(openTags - closeTags)}`);
    } else {
      console.log(`[generateDocx] ✓ XML tags are balanced`);
    }
    const unclosedTags = xmlContent.match(/<w:t[^>]*>(?![\s\S]*?<\/w:t>)/g);
    if (unclosedTags) {
      console.warn(`[generateDocx] ⚠️  Found ${unclosedTags.length} potentially unclosed <w:t> tags`);
    }
    console.log('[generateDocx] Step 5: Updating document.xml in ZIP...');
    const originalXmlLength = documentXml.asText().length;
    zip.file('word/document.xml', xmlContent);
    console.log(`[generateDocx] Updated XML: ${originalXmlLength} -> ${xmlContent.length} characters`);
    
    console.log('[generateDocx] Step 6: Generating new DOCX buffer...');
    console.log(`[generateDocx] ZIP files before generation: ${Object.keys(zip.files).length}`);
    
    const outputBuffer = Buffer.from(zip.generate({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }));
    
    console.log(`[generateDocx] Generated buffer size: ${outputBuffer.length} bytes`);
    console.log(`[generateDocx] Original buffer size: ${originalBuffer.length} bytes`);
    console.log(`[generateDocx] Size difference: ${outputBuffer.length - originalBuffer.length} bytes`);
    console.log('[generateDocx] ✓ Successfully generated filled document with preserved formatting');
    console.log('[generateDocx] ========================================');
    return outputBuffer;

  } catch (error) {
    console.error('[generateDocx] Error in XML manipulation approach, falling back to text replacement:', error);
    console.error('[generateDocx] Error details:', error instanceof Error ? error.stack : String(error));
    
    if (!fallbackText) {
      const textResult = await mammoth.extractRawText({ buffer: originalBuffer });
      fallbackText = textResult.value;
    }

    if (!fallbackText) {
      throw new Error('Failed to extract text from document for fallback replacement');
    }

    let filledText = fallbackText;
    
    for (const placeholder of placeholders) {
      const value = responses[placeholder.key];
      if (!value) continue;

      const patterns: RegExp[] = [];
      
      if (placeholder.originalPattern) {
        patterns.push(new RegExp(escapeRegex(placeholder.originalPattern), 'gi'));
      }
      
      patterns.push(
        new RegExp(`\\[${escapeRegex(placeholder.key)}\\]`, 'gi'),
        new RegExp(`\\{\\{${escapeRegex(placeholder.key)}\\}\\}`, 'gi'),
        new RegExp(`\\[${escapeRegex(placeholder.label)}\\]`, 'gi'),
        new RegExp(`\\[${escapeRegex(placeholder.key.replace(/_/g, ' ').toUpperCase())}\\]`, 'gi'),
        new RegExp(`\\[${escapeRegex(placeholder.key.replace(/_/g, ' '))}\\]`, 'gi'),
      );
    
    for (const pattern of patterns) {
      filledText = filledText.replace(pattern, value);
    }
  }
  
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  
  const paragraphs = filledText
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((text) => {
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

  const doc = new Document({
    sections: [
      {
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
  }
}

