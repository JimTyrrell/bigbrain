import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import {
  SESSION_COOKIE,
  clearFailures,
  clearedCookie,
  getSessionSecret,
  hashPin,
  isAuthenticated,
  lockRemaining,
  recordFailure,
  rotateSessionSecret,
  sessionCookie,
  signToken,
  verifyPin,
} from "../lib/auth";
import { HttpError } from "../lib/errors";
import { pinField, readJson } from "../lib/validate";

const app = new Hono<AppEnv>();

const clientIp = (c: Context<AppEnv>) => c.req.header("CF-Connecting-IP") ?? "unknown";

const invalid = () => new HttpError(401, "invalid_credentials", "Incorrect PIN");

async function ensureNotLocked(c: Context<AppEnv>) {
  const remaining = await lockRemaining(c.env, clientIp(c));
  if (remaining > 0) {
    c.header("Retry-After", String(remaining));
    throw new HttpError(429, "locked", "Too many failed attempts. Try again later.", { retryAfterSeconds: remaining });
  }
}

async function loginResponse(c: Context<AppEnv>, secret?: string) {
  const token = await signToken(secret ?? (await getSessionSecret(c.env)));
  c.header("Set-Cookie", sessionCookie(token));
  return c.body(null, 204);
}

app.get("/auth/status", async (c) => {
  const pinSet = (await c.env.KV.get("pin_hash")) !== null;
  const authenticated = pinSet && (await isAuthenticated(c.env, getCookie(c, SESSION_COOKIE)));
  return c.json({ pinSet, authenticated });
});

app.post("/auth/setup", async (c) => {
  const body = await readJson(c);
  if ((await c.env.KV.get("pin_hash")) !== null) throw new HttpError(409, "pin_already_set", "A PIN is already set");
  const pin = pinField(body, "pin");
  await c.env.KV.put("pin_hash", await hashPin(pin));
  return loginResponse(c);
});

app.post("/auth/login", async (c) => {
  await ensureNotLocked(c);
  const body = await readJson(c);
  const pin = typeof body.pin === "string" ? body.pin : "";
  const stored = await c.env.KV.get("pin_hash");
  if (!stored) throw new HttpError(409, "pin_not_set", "No PIN has been set yet");
  if (!(await verifyPin(pin, stored))) {
    await recordFailure(c.env, clientIp(c));
    throw invalid();
  }
  await clearFailures(c.env, clientIp(c));
  return loginResponse(c);
});

// Requires a session (enforced by the auth middleware).
app.post("/auth/change-pin", async (c) => {
  await ensureNotLocked(c);
  const body = await readJson(c);
  const current = typeof body.currentPin === "string" ? body.currentPin : "";
  const newPin = pinField(body, "newPin");
  const stored = await c.env.KV.get("pin_hash");
  if (!stored || !(await verifyPin(current, stored))) {
    await recordFailure(c.env, clientIp(c));
    throw invalid();
  }
  await clearFailures(c.env, clientIp(c));
  await c.env.KV.put("pin_hash", await hashPin(newPin));
  // Invalidate all other sessions; keep this one signed in.
  return loginResponse(c, await rotateSessionSecret(c.env));
});

app.post("/auth/logout", (c) => {
  c.header("Set-Cookie", clearedCookie);
  return c.body(null, 204);
});

export default app;
