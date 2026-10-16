import { Hono } from "hono";
import type { AppEnv } from "../env";
import { badRequest } from "../lib/errors";
import { MODELS, getDefaultModel, isKnownModel } from "../lib/models";
import { readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

app.get("/settings", async (c) => c.json({ defaultModel: await getDefaultModel(c.env), models: MODELS }));

app.put("/settings", async (c) => {
  const body = await readJson(c);
  if (!isKnownModel(body.defaultModel)) throw badRequest("invalid_model", "defaultModel must be one of the curated models");
  await c.env.KV.put("settings", JSON.stringify({ defaultModel: body.defaultModel }));
  return c.json({ defaultModel: body.defaultModel });
});

export default app;
