// app/api/upload/route.ts

import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { detectPlaceholders } from '@/lib/detectPlaceholders';
import { saveSession } from '@/lib/documentStore';
import OpenAI from 'openai';
import { Placeholder, PlaceholderDetected } from '@/lib/types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    // LLM-powered placeholder detection
    const placeholders = await detectPlaceholders(text);

    // LLM generates initial greeting
    const greeting = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful legal assistant. Generate a brief, friendly greeting for a user who just uploaded a legal document."
        },
        {
          role: "user",
          content: `User uploaded: ${file.name}. It has ${placeholders.length} fields to fill. Generate a warm, professional greeting (2-3 sentences) and mention the first field: "${placeholders[0]?.label}"`
        }
      ],
      temperature: 0.7,
    });

    const greetingMessage = greeting.choices[0].message.content || 
      `Thank you for uploading "${file.name}". I found ${placeholders.length} field${placeholders.length !== 1 ? 's' : ''} that need to be filled. Let's get started!`;

    // Create session
    const session = {
      id: uuidv4(),
      fileName: file.name,
      originalText: text,
      originalBuffer: Buffer.from(arrayBuffer), // Store original for regeneration
      placeholders: placeholders, // Save detected placeholders to session
      currentPlaceholderIndex: 0,
      responses: {} as Record<string, string>,
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
        key: p.key,
        name: p.label,
        type: p.type,
        required: p.required,
        description: p.description || "",
        value: "",      // empty initially
        filled: false  // track if the placeholder has been filled
    })),
    uploadedAt: session.createdAt,
    completed: false,       // document is not yet completed
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