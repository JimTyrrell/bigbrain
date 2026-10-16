import type { Env } from "../env";

export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_COOKIE = "bb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_FAILS = 5;
export const LOCK_SECONDS = 15 * 60;

const enc = new TextEncoder();

// ---------- encoding helpers ----------

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const toB64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Constant-time comparison of two byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---------- PIN hashing (PBKDF2-SHA256) ----------

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`. */
export async function hashPin(pin: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt, iterations);
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  const iterations = Number(iter);
  if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 1 || !saltB64 || !hashB64) return false;
  try {
    const expected = fromB64(hashB64);
    const actual = await pbkdf2(pin, fromB64(saltB64), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- session tokens (HMAC-SHA256) ----------

async function hmac(secretB64: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromB64(secretB64) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function newSecret(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32)));
}

/** Token = `<expSeconds>.<nonce>.<sig>` where sig = HMAC(secret, "<exp>.<nonce>"). */
export async function signToken(secretB64: string, ttlSeconds = SESSION_TTL_SECONDS, nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const nonce = toB64Url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `${exp}.${nonce}`;
  return `${payload}.${toB64Url(await hmac(secretB64, payload))}`;
}

export async function verifyToken(token: string, secretB64: string, nowMs = Date.now()): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  const expNum = Number(exp);
  if (!/^\d+$/.test(exp) || expNum * 1000 <= nowMs) return false;
  const expected = toB64Url(await hmac(secretB64, `${exp}.${nonce}`));
  return timingSafeEqual(enc.encode(sig), enc.encode(expected));
}

// ---------- KV-backed state ----------

export async function getSessionSecret(env: Env): Promise<string> {
  const existing = await env.KV.get("session_secret");
  if (existing) return existing;
  const secret = newSecret();
  await env.KV.put("session_secret", secret);
  return secret;
}

export async function rotateSessionSecret(env: Env): Promise<string> {
  const secret = newSecret();
  await env.KV.put("session_secret", secret);
  return secret;
}

export async function isAuthenticated(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = await env.KV.get("session_secret");
  if (!secret) return false;
  return verifyToken(token, secret);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

// ---------- login throttling ----------

interface FailState {
  count: number;
  until: number; // epoch ms when the lock ends, 0 if not locked
}

const failKey = (ip: string) => `login_fail:${ip}`;

/** Seconds remaining on the lock for this IP, or 0 if not locked. */
export async function lockRemaining(env: Env, ip: string, nowMs = Date.now()): Promise<number> {
  const state = await env.KV.get<FailState>(failKey(ip), "json");
  if (!state || !state.until || state.until <= nowMs) return 0;
  return Math.ceil((state.until - nowMs) / 1000);
}

export async function recordFailure(env: Env, ip: string, nowMs = Date.now()): Promise<void> {
  const prev = (await env.KV.get<FailState>(failKey(ip), "json")) ?? { count: 0, until: 0 };
  const count = prev.count + 1;
  const until = count >= MAX_FAILS ? nowMs + LOCK_SECONDS * 1000 : 0;
  await env.KV.put(failKey(ip), JSON.stringify({ count, until }), { expirationTtl: LOCK_SECONDS });
}

export async function clearFailures(env: Env, ip: string): Promise<void> {
  await env.KV.delete(failKey(ip));
}
