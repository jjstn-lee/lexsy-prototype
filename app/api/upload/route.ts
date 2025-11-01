// app/api/upload/route.ts

import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { DetectionAgent } from '@/lib/agents/DetectionAgent';
import { saveSession } from '@/lib/documentStore';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { PlaceholderDetected } from '@/lib/types';

const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  apiKey: process.env.GOOGLE_AI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Extract text
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value;

    const detectionAgent = new DetectionAgent();
    const placeholders = await detectionAgent.detect(text);
    
    const messages = [
      new SystemMessage("You are a helpful legal assistant. Generate a brief, friendly greeting for a user who just uploaded a legal document."),
      new HumanMessage(`User uploaded: ${file.name}. It has ${placeholders.length} fields to fill. Generate a warm, professional greeting (2-3 sentences) and mention the first field: "${placeholders[0]?.label}"`)
    ];
    
    const greetingResponse = await model.invoke(messages);
    const greetingMessage = greetingResponse.content?.toString() || 
      `Thank you for uploading "${file.name}". I found ${placeholders.length} field${placeholders.length !== 1 ? 's' : ''} that need to be filled. Let's get started!`;
    const session = {
      id: uuidv4(),
      fileName: file.name,
      originalText: text,
      originalBuffer: Buffer.from(arrayBuffer),
      placeholders: placeholders,
      currentPlaceholderIndex: 0,
      responses: {} as Record<string, string>,
      skippedPlaceholders: [] as string[],
      createdAt: new Date(),
    };

    console.log('[UPLOAD API] Created session with ID:', session.id);
    console.log('[UPLOAD API] Session ID type:', typeof session.id);
    console.log('[UPLOAD API] Session ID length:', session.id.length);
    
    await saveSession(session);

    console.log('[UPLOAD API] Returning response with id field:', session.id);
    return NextResponse.json({
    id: session.id,
    fileName: session.fileName,
    originalText: session.originalText,
    placeholders: placeholders.map((p: PlaceholderDetected) => ({
        id: p.key,
        name: p.label,
        type: p.type,
        required: p.required,
        description: p.description || "",
        value: "",
        filled: false
    })),
    uploadedAt: session.createdAt,
    completed: false,
    message: greetingMessage
    });


  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ 
      error: 'Failed to process document',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}