import { DocumentState, DocumentSession } from "@/lib/types";

// in-memory global document store
const globalAny: any = global;
if (!globalAny.documents) {
  globalAny.documents = new Map<string, DocumentState>();
}

export const documents: Map<string, DocumentState> = globalAny.documents;

// same thing for sessions
if (!globalAny.sessions) {
  globalAny.sessions = new Map<string, DocumentSession>();
}
export const sessions: Map<string, DocumentSession> = globalAny.sessions;

export async function saveSession(session: DocumentSession): Promise<void> {
  console.log('[DOCUMENT STORE] Saving session with id:', session.id);
  console.log('[DOCUMENT STORE] Session id type:', typeof session.id);
  console.log('[DOCUMENT STORE] Session id length:', session.id.length);
  sessions.set(session.id, session);
  console.log('[DOCUMENT STORE] Session saved. Total sessions in store:', sessions.size);
  console.log('[DOCUMENT STORE] All session IDs in store:', Array.from(sessions.keys()));
}

export async function getSession(sessionId: string): Promise<DocumentSession | null> {
  console.log('[DOCUMENT STORE] Looking up session with id:', sessionId);
  console.log('[DOCUMENT STORE] Lookup id type:', typeof sessionId);
  console.log('[DOCUMENT STORE] Lookup id length:', sessionId?.length);
  console.log('[DOCUMENT STORE] All session IDs in store:', Array.from(sessions.keys()));
  const session = sessions.get(sessionId) || null;
  if (session) {
    console.log('[DOCUMENT STORE] Found session with id:', session.id);
  } else {
    console.log('[DOCUMENT STORE] No session found for id:', sessionId);
  }
  return session;
}

export async function updateSession(sessionId: string, session: DocumentSession): Promise<void> {
  sessions.set(sessionId, session);
}