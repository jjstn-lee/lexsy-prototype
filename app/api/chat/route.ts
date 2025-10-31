// app/api/chat/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/documentStore';
import { ConversationManager } from '@/lib/conversationManager';

export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = await request.json();

    // get session
    const session = await getSession(sessionId);
    if (!session) {
      console.log('[CHAT API] Session not found, returning 404');
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // initialize conversation manager
    const manager = new ConversationManager(session);

    // process user response
    const result = await manager.processUserResponse(message);
    
    console.log('[CHAT API] processUserResponse result:', JSON.stringify(result, null, 2));

    // update session
    await updateSession(sessionId, session);
    console.log('[CHAT API] Session updated, current responses:', JSON.stringify(session.responses, null, 2));

    // if done, generate document
    let downloadUrl = null;
    if (result.isComplete) {
      console.log('[CHAT API] Document is complete, returning completion message');
      downloadUrl = `/api/download/${sessionId}`;
      
      return NextResponse.json({
        message: result.response + "\n\n✅ All information collected! Your document is ready.",
        isComplete: true,
        downloadUrl,
        responses: session.responses
      });
    }

    // get next question if needed
    // continue conversation if:
    // 1. user was understood AND we extracted values (regardless of needsClarification flag)
    // 2. OR if needsClarification is false
    const hasExtractedValues = result.extractedValues && Object.keys(result.extractedValues).length > 0;
    const shouldContinue = hasExtractedValues || (!result.needsClarification && result.understood);
    
    console.log('[CHAT API] Decision logic:', {
      understood: result.understood,
      needsClarification: result.needsClarification,
      hasExtractedValues,
      extractedValuesKeys: result.extractedValues ? Object.keys(result.extractedValues) : [],
      shouldContinue
    });

    let nextMessage = result.response;
    if (shouldContinue) {
      console.log('[CHAT API] Should continue conversation, calling getNextQuestion()');
      const nextQuestion = await manager.getNextQuestion();
      console.log('[CHAT API] Next question received:', nextQuestion);
      nextMessage = result.response ? (result.response + "\n\n" + nextQuestion) : nextQuestion;
    } else {
      console.log('[CHAT API] Should not continue conversation, returning only response:', result.response);
    }

    console.log('[CHAT API] Returning message:', nextMessage);

    return NextResponse.json({
      message: nextMessage,
      isComplete: false,
      currentResponses: session.responses
    });

  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}