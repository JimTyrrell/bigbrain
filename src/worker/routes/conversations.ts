import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
  type MessageRow,
  deleteConversationsStmts,
  getBrain,
  getConversation,
  listConversations,
  toConversation,
  toMessage,
} from "../lib/db";
import { badRequest } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { getDefaultModel, isKnownModel } from "../lib/models";
import { readJson, reqString } from "../lib/validate";

const app = new Hono<AppEnv>();

const checkModel = (m: unknown) => {
  if (!isKnownModel(m)) throw badRequest("invalid_model", "model must be one of the curated models");
  return m;
};

app.get("/brains/:brainId/conversations", async (c) => {
  const brain = await getBrain(c.env, c.req.param("brainId"));
  return c.json({ conversations: (await listConversations(c.env, brain.id)).map(toConversation) });
});

app.post("/brains/:brainId/conversations", async (c) => {
  const brain = await getBrain(c.env, c.req.param("brainId"));
  const body = await readJson(c, true);
  const model = body.model === undefined ? await getDefaultModel(c.env) : checkModel(body.model);
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO conversations (id, brain_id, title, model, created_at, updated_at) VALUES (?, ?, 'New chat', ?, ?, ?)",
  )
    .bind(id, brain.id, model, now, now)
    .run();
  return c.json({ conversation: toConversation(await getConversation(c.env, id)) }, 201);
});

app.delete("/brains/:brainId/conversations", async (c) => {
  const brain = await getBrain(c.env, c.req.param("brainId"));
  await c.env.DB.batch(deleteConversationsStmts(c.env, "brain_id = ?", brain.id));
  return c.body(null, 204);
});

app.get("/conversations/:id", async (c) => {
  const conv = await getConversation(c.env, c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
  )
    .bind(conv.id)
    .all<MessageRow>();
  return c.json({ conversation: toConversation(conv), messages: results.map(toMessage) });
});

app.patch("/conversations/:id", async (c) => {
  const conv = await getConversation(c.env, c.req.param("id"));
  const body = await readJson(c);
  const title = body.title === undefined ? conv.title : reqString(body, "title", { max: 200 });
  const model = body.model === undefined ? conv.model : checkModel(body.model);
  await c.env.DB.prepare("UPDATE conversations SET title = ?, model = ?, updated_at = ? WHERE id = ?")
    .bind(title, model, nowIso(), conv.id)
    .run();
  return c.json({ conversation: toConversation(await getConversation(c.env, conv.id)) });
});

app.delete("/conversations/:id", async (c) => {
  const conv = await getConversation(c.env, c.req.param("id"));
  await c.env.DB.batch(deleteConversationsStmts(c.env, "id = ?", conv.id));
  return c.body(null, 204);
});

export default app;
