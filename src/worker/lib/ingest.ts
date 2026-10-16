import type { Env } from "../env";
import { embed } from "./ai";
import { chunkText } from "./chunk";
import { clearDocumentIndex, deleteVectors } from "./db";
import { HttpError } from "./errors";
import { captionsToMarkdown } from "./vtt";

export const TEXT_EXTENSIONS = ["txt", "md", "markdown"];
export const CAPTION_EXTENSIONS = ["vtt", "srt"];

export interface Converted {
  content: string;
  sourceType: "upload" | "transcript";
}

export const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

/** Convert an uploaded file to Markdown. Throws 415 for unsupported types. */
export async function fileToMarkdown(env: Env, file: File): Promise<Converted> {
  const ext = extensionOf(file.name);
  if (CAPTION_EXTENSIONS.includes(ext)) return { content: captionsToMarkdown(await file.text()), sourceType: "transcript" };
  if (TEXT_EXTENSIONS.includes(ext)) return { content: await file.text(), sourceType: "upload" };

  const supported = await env.AI.toMarkdown().supported();
  const mime = file.type.split(";")[0].trim().toLowerCase();
  const ok = supported.some((s) => s.extension.replace(/^\./, "").toLowerCase() === ext || (mime && s.mimeType === mime));
  if (!ok) throw new HttpError(415, "unsupported_type", `Unsupported file type${ext ? ` .${ext}` : ""}`);

  const res = await env.AI.toMarkdown({ name: file.name, blob: new Blob([await file.arrayBuffer()], { type: file.type }) });
  if (res.format === "error") throw new HttpError(422, "conversion_failed", `Could not convert file: ${res.error}`);
  return { content: res.data, sourceType: "upload" };
}

const UPSERT_BATCH = 100;

/** (Re)build chunks + vectors for a document and record the outcome on the row. */
export async function indexDocument(env: Env, documentId: string): Promise<void> {
  const doc = await env.DB.prepare("SELECT id, brain_id, content FROM documents WHERE id = ?")
    .bind(documentId)
    .first<{ id: string; brain_id: string; content: string }>();
  if (!doc) return;
  const ids: string[] = [];
  // Taken just before the last upsert, so Vectorize's mutation time is >= this (see refreshSearchable).
  let writtenAt = new Date().toISOString();
  try {
    await clearDocumentIndex(env, doc.id);
    const chunks = chunkText(doc.content);
    const vectors = await embed(env, chunks.map((c) => c.text));
    for (let i = 0; i < chunks.length; i += UPSERT_BATCH) {
      const batch = chunks.slice(i, i + UPSERT_BATCH);
      writtenAt = new Date().toISOString();
      await env.VECTORIZE.upsert(
        batch.map((c, j) => {
          const id = `${doc.id}:${c.idx}`;
          ids.push(id);
          return { id, values: vectors[i + j], metadata: { brain_id: doc.brain_id, document_id: doc.id, idx: c.idx } };
        }),
      );
      await env.DB.batch(
        batch.map((c) =>
          env.DB.prepare("INSERT OR REPLACE INTO chunks (id, document_id, brain_id, idx, text, timestamp) VALUES (?, ?, ?, ?, ?, ?)").bind(
            `${doc.id}:${c.idx}`,
            doc.id,
            doc.brain_id,
            c.idx,
            c.text,
            c.timestamp,
          ),
        ),
      );
    }
    // Vectorize makes upserts queryable 1-3 minutes later; `searchable` flips once describe() catches up.
    const updated = await env.DB.prepare(
      `UPDATE documents SET index_status = 'indexed', index_error = NULL, chunk_count = ?, vector_written_at = ?,
         searchable = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(chunks.length, writtenAt, chunks.length ? 0 : 1, new Date().toISOString(), doc.id)
      .run();
    // The document was deleted while we were indexing: don't leave orphaned vectors behind.
    if (!updated.meta.changes) await deleteVectors(env, ids);
  } catch (err) {
    console.error("indexing failed", documentId, err);
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await env.DB.prepare("UPDATE documents SET index_status = 'error', index_error = ?, updated_at = ? WHERE id = ?")
      .bind(message, new Date().toISOString(), doc.id)
      .run();
  }
}

/** After this long, assume Vectorize has caught up even if describe() says otherwise. */
export const SEARCHABLE_FALLBACK_MS = 10 * 60 * 1000;

/** Milliseconds from an ISO string or epoch number (seconds or ms); null if unparseable. */
export function toMillis(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Ids of rows whose vectors Vectorize has processed (or that are older than the fallback window). */
export function becameSearchable(
  rows: { id: string; vector_written_at: string | null }[],
  processedUpTo: unknown,
  nowMs = Date.now(),
): string[] {
  const processed = toMillis(processedUpTo);
  return rows
    .filter((r) => {
      const written = toMillis(r.vector_written_at);
      if (written === null) return true;
      return (processed !== null && written <= processed) || nowMs - written > SEARCHABLE_FALLBACK_MS;
    })
    .map((r) => r.id);
}

/** Flip `searchable` for indexed documents whose vectors are now queryable. One describe() call, only when needed. */
export async function refreshSearchable(env: Env, brainId?: string): Promise<void> {
  const where = `index_status = 'indexed' AND searchable = 0${brainId ? " AND brain_id = ?" : ""}`;
  const stmt = env.DB.prepare(`SELECT id, vector_written_at FROM documents WHERE ${where}`);
  const { results } = await (brainId ? stmt.bind(brainId) : stmt).all<{ id: string; vector_written_at: string | null }>();
  if (!results.length) return;
  let processedUpTo: unknown = null;
  try {
    // The V2 index reports `processedUpToDatetime`; the binding's declared type is the legacy V1 shape.
    processedUpTo = ((await env.VECTORIZE.describe()) as unknown as { processedUpToDatetime?: unknown }).processedUpToDatetime;
  } catch (err) {
    console.error("vectorize describe failed", err);
  }
  const ids = becameSearchable(results, processedUpTo);
  if (!ids.length) return;
  await env.DB.batch(ids.map((id) => env.DB.prepare("UPDATE documents SET searchable = 1 WHERE id = ?").bind(id)));
}
