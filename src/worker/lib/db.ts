import type { Env } from "../env";
import { notFound } from "./errors";

// ---------- row types ----------

export interface BrainRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  document_count?: number;
  conversation_count?: number;
}

export interface DocumentRow {
  id: string;
  brain_id: string;
  title: string;
  source_url: string | null;
  source_type: string;
  mime_type: string | null;
  bytes: number;
  content?: string;
  index_status: string;
  index_error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  brain_id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  citations: string;
  created_at: string;
}

export interface Citation {
  n: number;
  documentId: string;
  documentTitle: string;
  chunkId: string;
  timestamp: string | null;
  sourceUrl: string | null;
  link: string | null;
  excerpt: string;
}

// ---------- API mappers ----------

export const toBrain = (r: BrainRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  documentCount: r.document_count ?? 0,
  conversationCount: r.conversation_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toDocument = (r: DocumentRow, withContent = false) => ({
  id: r.id,
  brainId: r.brain_id,
  title: r.title,
  sourceUrl: r.source_url,
  sourceType: r.source_type,
  mimeType: r.mime_type,
  bytes: r.bytes,
  ...(withContent ? { content: r.content ?? "" } : {}),
  indexStatus: r.index_status,
  indexError: r.index_error,
  chunkCount: r.chunk_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toConversation = (r: ConversationRow) => ({
  id: r.id,
  brainId: r.brain_id,
  title: r.title,
  model: r.model,
  messageCount: r.message_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function toMessage(r: MessageRow) {
  let citations: Citation[] = [];
  try {
    citations = JSON.parse(r.citations);
  } catch {
    /* keep empty */
  }
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as "user" | "assistant",
    content: r.content,
    model: r.model,
    citations,
    createdAt: r.created_at,
  };
}

// ---------- queries ----------

const BRAIN_SELECT = `SELECT b.*,
  (SELECT COUNT(*) FROM documents d WHERE d.brain_id = b.id) AS document_count,
  (SELECT COUNT(*) FROM conversations c WHERE c.brain_id = b.id) AS conversation_count
  FROM brains b`;

export async function listBrains(env: Env): Promise<BrainRow[]> {
  const { results } = await env.DB.prepare(`${BRAIN_SELECT} ORDER BY b.created_at ASC`).all<BrainRow>();
  return results;
}

export async function getBrain(env: Env, id: string): Promise<BrainRow> {
  const row = await env.DB.prepare(`${BRAIN_SELECT} WHERE b.id = ?`).bind(id).first<BrainRow>();
  if (!row) throw notFound("Brain");
  return row;
}

const DOC_COLUMNS = `id, brain_id, title, source_url, source_type, mime_type, bytes, index_status,
  index_error, chunk_count, created_at, updated_at`;

export async function getDocument(env: Env, id: string, withContent = false): Promise<DocumentRow> {
  const cols = withContent ? `${DOC_COLUMNS}, content` : DOC_COLUMNS;
  const row = await env.DB.prepare(`SELECT ${cols} FROM documents WHERE id = ?`).bind(id).first<DocumentRow>();
  if (!row) throw notFound("Document");
  return row;
}

export async function listDocuments(env: Env, brainId: string): Promise<DocumentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${DOC_COLUMNS} FROM documents WHERE brain_id = ? ORDER BY created_at DESC`,
  )
    .bind(brainId)
    .all<DocumentRow>();
  return results;
}

const CONV_SELECT = `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
  FROM conversations c`;

export async function getConversation(env: Env, id: string): Promise<ConversationRow> {
  const row = await env.DB.prepare(`${CONV_SELECT} WHERE c.id = ?`).bind(id).first<ConversationRow>();
  if (!row) throw notFound("Conversation");
  return row;
}

export async function listConversations(env: Env, brainId: string): Promise<ConversationRow[]> {
  const { results } = await env.DB.prepare(`${CONV_SELECT} WHERE c.brain_id = ? ORDER BY c.updated_at DESC`)
    .bind(brainId)
    .all<ConversationRow>();
  return results;
}

// ---------- vector + cascade cleanup ----------

/** Vector ids for documents: from the chunks table plus `${id}:${i}` for i < chunk_count. */
async function vectorIdsFor(env: Env, where: string, bind: string): Promise<string[]> {
  const ids = new Set<string>();
  const chunks = await env.DB.prepare(
    `SELECT id FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE ${where})`,
  )
    .bind(bind)
    .all<{ id: string }>();
  for (const r of chunks.results) ids.add(r.id);
  const docs = await env.DB.prepare(`SELECT id, chunk_count FROM documents WHERE ${where}`)
    .bind(bind)
    .all<{ id: string; chunk_count: number }>();
  for (const d of docs.results) for (let i = 0; i < d.chunk_count; i++) ids.add(`${d.id}:${i}`);
  return [...ids];
}

/** Best-effort: a Vectorize hiccup must not block deleting rows (stale vectors are ignored at query time). */
export async function deleteVectors(env: Env, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) {
    try {
      await env.VECTORIZE.deleteByIds(ids.slice(i, i + 1000));
    } catch (err) {
      console.error("vector delete failed", err);
    }
  }
}

/** Remove a document's chunks and vectors (keeps the document row). */
export async function clearDocumentIndex(env: Env, documentId: string): Promise<void> {
  await deleteVectors(env, await vectorIdsFor(env, "id = ?", documentId));
  await env.DB.prepare("DELETE FROM chunks WHERE document_id = ?").bind(documentId).run();
}

export async function deleteDocument(env: Env, documentId: string): Promise<void> {
  await clearDocumentIndex(env, documentId);
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(documentId).run();
}

export async function deleteBrain(env: Env, brainId: string): Promise<void> {
  await deleteVectors(env, await vectorIdsFor(env, "brain_id = ?", brainId));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM chunks WHERE brain_id = ?").bind(brainId),
    env.DB.prepare(
      "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE brain_id = ?)",
    ).bind(brainId),
    env.DB.prepare("DELETE FROM conversations WHERE brain_id = ?").bind(brainId),
    env.DB.prepare("DELETE FROM documents WHERE brain_id = ?").bind(brainId),
    env.DB.prepare("DELETE FROM brains WHERE id = ?").bind(brainId),
  ]);
}

export function deleteConversationsStmts(env: Env, where: string, bind: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ${where})`).bind(bind),
    env.DB.prepare(`DELETE FROM conversations WHERE ${where}`).bind(bind),
  ];
}
