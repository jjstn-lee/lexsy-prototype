// app/api/chat/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/documentStore';
import { Orchestrator } from '@/lib/agents/Orchestrator';

export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = await request.json();

    const session = await getSession(sessionId);
    if (!session) {
      console.log('[CHAT API] Session not found, returning 404');
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const orchestrator = new Orchestrator(session);
    const result = await orchestrator.processMessage(message);
    
    console.log('[CHAT API] Orchestrator result:', JSON.stringify(result, null, 2));

    await updateSession(sessionId, session);
    console.log('[CHAT API] Session updated, current responses:', JSON.stringify(session.responses, null, 2));

    if (result.isComplete) {
      console.log('[CHAT API] Document is complete, returning completion message');
      const downloadUrl = `/api/download/${sessionId}`;
      
      return NextResponse.json({
        message: result.message,
        isComplete: true,
        downloadUrl,
        responses: session.responses
      });
    }
    console.log('[CHAT API] Returning message:', result.message);

    return NextResponse.json({
      message: result.message,
      isComplete: false,
      currentResponses: session.responses,
      queryType: result.queryType
    });

  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}