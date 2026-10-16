import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { type Citation, type ConversationRow, type MessageRow, getBrain, getConversation, toMessage } from "../lib/db";
import { badRequest } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { runAi } from "../lib/ai";
import { TITLE_MODEL, type ChatMessage, isKnownModel, streamChat } from "../lib/models";
import { buildSystemPrompt } from "../lib/prompt";
import { filterCited, retrieve } from "../lib/retrieve";
import { encodeEvent } from "../lib/sse";
import { readJson, reqString } from "../lib/validate";

const app = new Hono<AppEnv>();

const HISTORY = 10;
const MAX_TOKENS = 3000;

/** Fallback title: first 6 words of the user's message. */
export function truncateTitle(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return words.length > 80 ? `${words.slice(0, 77)}...` : words || "New chat";
}

export function cleanTitle(raw: string): string | null {
  const line = raw.split("\n").map((l) => l.trim()).find((l) => l && !l.endsWith(":")) ?? "";
  const t = line
    .replace(/^(title\s*:\s*)/i, "")
    .split(/:\s/)[0] // drop subtitles ("X: A Strategic Guide")
    .replace(/["“”`*#]/g, "")
    .replace(/(^|\s)['‘’]+|['‘’]+(?=\s|$)/g, "$1") // quotes at word edges, keep apostrophes
    .replace(/[.!?:;,]+$/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return t && t.length <= 80 ? t : null;
}

export async function autoTitle(env: Env, question: string): Promise<string> {
  if (question.trim().split(/\s+/).length <= 6) return truncateTitle(question); // already short
  try {
    const res = (await runAi(env, TITLE_MODEL, {
      messages: [
        { role: "system", content: "Write a short title (at most 6 words) for a chat that starts with the user's message. Reply with the title only, no quotes." },
        { role: "user", content: question.slice(0, 2000) },
      ],
      max_tokens: 24,
      temperature: 0.2,
    })) as { response?: unknown };
    const t = typeof res?.response === "string" ? cleanTitle(res.response) : null;
    if (t) return t;
  } catch (err) {
    console.error("auto-title failed", err);
  }
  return truncateTitle(question);
}

app.post("/conversations/:id/messages", async (c) => {
  const env = c.env;
  const conv: ConversationRow = await getConversation(env, c.req.param("id"));
  const body = await readJson(c);
  const content = reqString(body, "content", { max: 8000 });
  if (body.model !== undefined && !isKnownModel(body.model)) {
    throw badRequest("invalid_model", "model must be one of the curated models");
  }
  const model = (body.model as string | undefined) ?? conv.model;
  const brain = await getBrain(env, conv.brain_id);

  const { results: prior } = await env.DB.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
  )
    .bind(conv.id, HISTORY)
    .all<MessageRow>();
  const history: ChatMessage[] = prior
    .reverse()
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  const firstExchange = (conv.message_count ?? 0) === 0;

  const userMessageId = newId();
  const assistantMessageId = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, conversation_id, role, content, model, citations, created_at) VALUES (?, ?, 'user', ?, NULL, '[]', ?)").bind(
      userMessageId,
      conv.id,
      content,
      nowIso(),
    ),
    env.DB.prepare("UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?").bind(model, nowIso(), conv.id),
  ]);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const signal = c.req.raw.signal;
  let clientGone = false;
  // Writes are not awaited: if the client disconnects nobody reads the stream, and awaiting would
  // block on backpressure forever. Replies are small, so buffering them is fine.
  const send = (event: string, data: unknown) => {
    if (clientGone || signal?.aborted) {
      clientGone = true;
      return;
    }
    writer.write(encodeEvent(event, data)).catch(() => {
      clientGone = true; // client aborted; keep going so the partial reply is saved
    });
  };

  const run = async () => {
    let reply = "";
    let citations: Citation[] = [];
    try {
      send("meta", { userMessageId, assistantMessageId, model });
      citations = await retrieve(env, brain.id, content);
      send("citations", { citations });
      const system = buildSystemPrompt(brain, citations);
      for await (const delta of streamChat(env, model, { system, messages: [...history, { role: "user", content }], maxTokens: MAX_TOKENS })) {
        reply += delta;
        send("token", { text: delta });
        if (clientGone || signal?.aborted) break;
      }
    } catch (err) {
      console.error("chat failed", err);
      send("error", { code: "ai_error", message: err instanceof Error ? err.message : "The model failed to respond" });
    }

    try {
      if (reply.trim()) {
        const row: MessageRow = {
          id: assistantMessageId,
          conversation_id: conv.id,
          role: "assistant",
          content: reply,
          model,
          citations: JSON.stringify(filterCited(reply, citations)),
          created_at: nowIso(),
        };
        const stmts = [
          env.DB.prepare("INSERT INTO messages (id, conversation_id, role, content, model, citations, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?)").bind(
            row.id,
            row.conversation_id,
            row.content,
            row.model,
            row.citations,
            row.created_at,
          ),
        ];
        if (firstExchange) {
          stmts.push(env.DB.prepare("UPDATE conversations SET title = ? WHERE id = ?").bind(await autoTitle(env, content), conv.id));
        }
        stmts.push(env.DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").bind(nowIso(), conv.id));
        await env.DB.batch(stmts);
        send("done", { message: toMessage(row) });
      } else if (firstExchange) {
        await env.DB.prepare("UPDATE conversations SET title = ? WHERE id = ?").bind(truncateTitle(content), conv.id).run();
      }
    } catch (err) {
      console.error("saving reply failed", err);
      send("error", { code: "save_failed", message: "Could not save the reply" });
    } finally {
      if (!clientGone) writer.close().catch(() => {});
    }
  };

  c.executionCtx.waitUntil(run());
  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform"},
  });
});

export default app;
