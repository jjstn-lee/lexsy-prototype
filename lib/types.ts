export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface Placeholder {
  id: string;
  name: string;
  description?: string;
  value?: string;
  filled: boolean;
}

export interface DocumentState {
  id: string;
  fileName: string;
  uploadedAt: Date;
  templateText: string;
  placeholders: Placeholder[];
  completed: boolean;
}

export interface PlaceholderDetected {
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'email' | 'address';
  required: boolean;
  originalPattern?: string;
}

export interface DocumentSession {
  id: string;
  fileName: string;
  originalText: string;
  originalBuffer: Buffer;
  placeholders: PlaceholderDetected[];
  currentPlaceholderIndex: number;
  responses: Record<string, string>;
  skippedPlaceholders: string[]; // Track placeholders that have been skipped
  createdAt: Date;
}

export interface ChatState {
  messages: Message[];
  document: DocumentState | null;
  currentPlaceholder: Placeholder | null;
  isProcessing: boolean;
}
