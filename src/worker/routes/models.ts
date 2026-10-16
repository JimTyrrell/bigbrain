import { Hono } from "hono";
import type { AppEnv } from "../env";
import { MODELS, getDefaultModel } from "../lib/models";

const app = new Hono<AppEnv>();

app.get("/models", async (c) => c.json({ models: MODELS, defaultModel: await getDefaultModel(c.env) }));

export default app;
