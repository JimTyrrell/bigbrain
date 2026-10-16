import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { deleteDocument, getBrain, getDocument, listDocuments, toDocument } from "../lib/db";
import { HttpError, badRequest } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { fileToMarkdown, indexDocument, refreshSearchable } from "../lib/ingest";
import { captionsToMarkdown, looksLikeCaptions } from "../lib/vtt";
import { optString, optUrl, parseUrl, readJson, reqString } from "../lib/validate";

const app = new Hono<AppEnv>();

const TITLE = { max: 300 };
const MAX_CONTENT = 5_000_000; // characters
const SOURCE_TYPES = ["upload", "text", "transcript"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const byteLength = (s: string) => new TextEncoder().encode(s).length;

function checkContent(content: string): string {
  if (!content.trim()) throw badRequest("invalid_input", "content is empty");
  if (content.length > MAX_CONTENT) throw new HttpError(413, "too_large", "Document content is too large");
  return content;
}

function startIndexing(c: Context<AppEnv>, id: string) {
  c.executionCtx.waitUntil(indexDocument(c.env, id));
}

interface NewDoc {
  title: string;
  sourceUrl: string | null;
  sourceType: SourceType;
  mimeType: string | null;
  bytes: number;
  content: string;
}

async function readNewDocument(c: Context<AppEnv>): Promise<NewDoc> {
  const type = c.req.header("Content-Type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw badRequest("invalid_input", "Malformed multipart body");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw badRequest("invalid_input", "file is required");
    const fields = { title: form.get("title") ?? undefined, sourceUrl: form.get("sourceUrl") ?? undefined };
    const title =
      typeof fields.title === "string" && fields.title.trim()
        ? reqString(fields, "title", TITLE)
        : file.name.replace(/\.[^.]+$/, "").slice(0, TITLE.max) || "Untitled";
    const sourceUrl = typeof fields.sourceUrl === "string" && fields.sourceUrl.trim() ? parseUrl(fields.sourceUrl) : null;
    const converted = await fileToMarkdown(c.env, file);
    return {
      title,
      sourceUrl,
      sourceType: converted.sourceType,
      mimeType: file.type || null,
      bytes: file.size,
      content: checkContent(converted.content),
    };
  }
  if (!type.includes("json")) throw new HttpError(415, "unsupported_type", "Send JSON or multipart/form-data");
  const body = await readJson(c);
  const title = reqString(body, "title", TITLE);
  if (typeof body.content !== "string") throw badRequest("invalid_input", "content is required");
  const sourceType = body.sourceType ?? "text";
  if (!SOURCE_TYPES.includes(sourceType as SourceType)) throw badRequest("invalid_input", "invalid sourceType");
  let content = checkContent(body.content);
  if (looksLikeCaptions(content)) content = captionsToMarkdown(content);
  return {
    title,
    sourceUrl: optUrl(body, "sourceUrl") ?? null,
    sourceType: sourceType as SourceType,
    mimeType: null,
    bytes: byteLength(content),
    content,
  };
}

app.get("/brains/:brainId/documents", async (c) => {
  const brain = await getBrain(c.env, c.req.param("brainId"));
  await refreshSearchable(c.env, brain.id);
  return c.json({ documents: (await listDocuments(c.env, brain.id)).map((d) => toDocument(d)) });
});

app.post("/brains/:brainId/documents", async (c) => {
  const brain = await getBrain(c.env, c.req.param("brainId"));
  const doc = await readNewDocument(c);
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO documents (id, brain_id, title, source_url, source_type, mime_type, bytes, content, index_status,
       chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  )
    .bind(id, brain.id, doc.title, doc.sourceUrl, doc.sourceType, doc.mimeType, doc.bytes, doc.content, now, now)
    .run();
  startIndexing(c, id);
  return c.json({ document: toDocument(await getDocument(c.env, id)) }, 201);
});

app.get("/documents/:id", async (c) => {
  const doc = await getDocument(c.env, c.req.param("id"));
  await refreshSearchable(c.env, doc.brain_id);
  return c.json({ document: toDocument(await getDocument(c.env, doc.id, true), true) });
});

app.patch("/documents/:id", async (c) => {
  const doc = await getDocument(c.env, c.req.param("id"), true);
  const body = await readJson(c);
  const title = body.title === undefined ? doc.title : reqString(body, "title", TITLE);
  const sourceUrl = optUrl(body, "sourceUrl");
  const content = optString(body, "content", { max: MAX_CONTENT });
  if (content !== undefined) checkContent(content);
  const contentChanged = content !== undefined && body.content !== doc.content;
  const newContent = contentChanged ? (body.content as string) : doc.content!;
  await c.env.DB.prepare(
    `UPDATE documents SET title = ?, source_url = ?, content = ?, bytes = ?, index_status = ?, index_error = ?,
       updated_at = ? WHERE id = ?`,
  )
    .bind(
      title,
      sourceUrl === undefined ? doc.source_url : sourceUrl,
      newContent,
      contentChanged ? byteLength(newContent) : doc.bytes,
      contentChanged ? "pending" : doc.index_status,
      contentChanged ? null : doc.index_error,
      nowIso(),
      doc.id,
    )
    .run();
  if (contentChanged) startIndexing(c, doc.id);
  return c.json({ document: toDocument(await getDocument(c.env, doc.id)) });
});

app.post("/documents/:id/reindex", async (c) => {
  const doc = await getDocument(c.env, c.req.param("id"));
  await c.env.DB.prepare("UPDATE documents SET index_status = 'pending', index_error = NULL, updated_at = ? WHERE id = ?")
    .bind(nowIso(), doc.id)
    .run();
  startIndexing(c, doc.id);
  return c.json({ document: toDocument(await getDocument(c.env, doc.id)) }, 202);
});

app.delete("/documents/:id", async (c) => {
  const doc = await getDocument(c.env, c.req.param("id"));
  await deleteDocument(c.env, doc.id);
  return c.body(null, 204);
});

export default app;
