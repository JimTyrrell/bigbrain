import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { SESSION_COOKIE, isAuthenticated } from "./lib/auth";
import { errorBody, errorResponse } from "./lib/errors";
import authRoutes from "./routes/auth";
import brainRoutes from "./routes/brains";
import chatRoutes from "./routes/chat";
import conversationRoutes from "./routes/conversations";
import documentRoutes from "./routes/documents";
import modelRoutes from "./routes/models";
import settingsRoutes from "./routes/settings";
import transcribeRoutes from "./routes/transcribe";

const VERSION = "0.1.0";
const MAX_BODY = 25 * 1024 * 1024;
const PUBLIC_API = new Set(["/api/health", "/api/auth/status", "/api/auth/setup", "/api/auth/login"]);

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self)",
};

const app = new Hono<AppEnv>();

// Security headers on every response (asset responses are re-wrapped so headers are mutable).
app.use("*", async (c, next) => {
  await next();
  const res = new Response(c.res.body, c.res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (c.req.path.startsWith("/api/")) res.headers.set("Cache-Control", res.headers.get("Cache-Control") ?? "no-store");
  c.res = res;
});

app.use(
  "/api/*",
  bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json(errorBody("too_large", "Request body exceeds 25 MB"), 413) }),
);

app.use("/api/*", async (c, next) => {
  if (PUBLIC_API.has(c.req.path)) return next();
  if (!(await isAuthenticated(c.env, getCookie(c, SESSION_COOKIE)))) {
    return c.json(errorBody("unauthorized", "Sign in required"), 401);
  }
  return next();
});

app.get("/api/health", (c) => c.json({ ok: true, version: VERSION, time: new Date().toISOString() }));

for (const routes of [authRoutes, settingsRoutes, modelRoutes, brainRoutes, documentRoutes, conversationRoutes, chatRoutes, transcribeRoutes]) {
  app.route("/api", routes);
}

app.all("/api/*", (c) => c.json(errorBody("not_found", "No such API route"), 404));

// Everything else: static assets / SPA shell.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => errorResponse(c, err));

export default app;
