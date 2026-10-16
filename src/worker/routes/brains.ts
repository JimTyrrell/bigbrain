import { Hono } from "hono";
import type { AppEnv } from "../env";
import { deleteBrain, getBrain, listBrains, toBrain } from "../lib/db";
import { badRequest } from "../lib/errors";
import { newId, nowIso } from "../lib/ids";
import { optString, readJson, reqString } from "../lib/validate";

const app = new Hono<AppEnv>();

const NAME = { max: 100 };
const DESCRIPTION = { max: 300 };

app.get("/brains", async (c) => c.json({ brains: (await listBrains(c.env)).map(toBrain) }));

app.post("/brains", async (c) => {
  const body = await readJson(c);
  const name = reqString(body, "name", NAME);
  const description = optString(body, "description", DESCRIPTION) ?? "";
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare("INSERT INTO brains (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, description, now, now)
    .run();
  return c.json({ brain: toBrain(await getBrain(c.env, id)) }, 201);
});

app.get("/brains/:id", async (c) => c.json({ brain: toBrain(await getBrain(c.env, c.req.param("id"))) }));

app.patch("/brains/:id", async (c) => {
  const brain = await getBrain(c.env, c.req.param("id"));
  const body = await readJson(c);
  const name = body.name === undefined ? undefined : reqString(body, "name", NAME);
  const description = optString(body, "description", DESCRIPTION);
  if (name === undefined && description === undefined) throw badRequest("invalid_input", "Nothing to update");
  await c.env.DB.prepare("UPDATE brains SET name = ?, description = ?, updated_at = ? WHERE id = ?")
    .bind(name ?? brain.name, description ?? brain.description, nowIso(), brain.id)
    .run();
  return c.json({ brain: toBrain(await getBrain(c.env, brain.id)) });
});

app.delete("/brains/:id", async (c) => {
  const brain = await getBrain(c.env, c.req.param("id"));
  await deleteBrain(c.env, brain.id);
  return c.body(null, 204);
});

export default app;
