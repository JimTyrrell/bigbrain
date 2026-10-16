// Types mirrored from docs/API.md (the contract). Keep in sync with the backend.

export type ModelInfo = {
  id: string;
  label: string;
  vendor: string;
  contextWindow: number;
  note: string;
  recommended?: boolean;
};

export type Brain = {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  conversationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SourceType = "upload" | "text" | "transcript";
export type IndexStatus = "pending" | "indexed" | "error";

export type BrainDocument = {
  id: string;
  brainId: string;
  title: string;
  sourceUrl: string | null;
  sourceType: SourceType;
  mimeType: string | null;
  bytes: number;
  content?: string;
  indexStatus: IndexStatus;
  indexError: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  brainId: string;
  title: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Citation = {
  n: number;
  documentId: string;
  documentTitle: string;
  chunkId: string;
  timestamp: string | null;
  sourceUrl: string | null;
  link: string | null;
  excerpt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  citations: Citation[];
  createdAt: string;
};

export type AuthStatus = { pinSet: boolean; authenticated: boolean };
export type Settings = { defaultModel: string; models: ModelInfo[] };
export type ModelsResponse = { models: ModelInfo[]; defaultModel: string };
export type Transcription = { text: string; language: string | null; durationSeconds: number | null };

// SSE chat events
export type ChatMeta = { userMessageId: string; assistantMessageId: string; model: string };
export type ChatHandlers = {
  onMeta?: (m: ChatMeta) => void;
  onCitations?: (c: Citation[]) => void;
  onToken?: (text: string) => void;
  onDone?: (message: Message) => void;
  onError?: (e: { code: string; message: string }) => void;
};
