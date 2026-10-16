import type { Context } from "hono";
import { HttpError, badRequest } from "./errors";

export type Body = Record<string, unknown>;

/** Parse a JSON object body or throw 400. With `optional`, an empty body yields `{}`. */
export async function readJson(c: Context, optional = false): Promise<Body> {
  let body: unknown;
  try {
    const text = await c.req.text();
    if (optional && !text.trim()) return {};
    body = JSON.parse(text);
  } catch {
    throw badRequest("invalid_json", "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("invalid_json", "Request body must be a JSON object");
  }
  return body as Body;
}

interface StrOpts {
  min?: number;
  max: number;
  code?: string;
}

/** Required trimmed string within length bounds. */
export function reqString(body: Body, key: string, opts: StrOpts): string {
  const v = body[key];
  const code = opts.code ?? "invalid_input";
  if (typeof v !== "string") throw badRequest(code, `${key} is required`);
  const s = v.trim();
  if (s.length < (opts.min ?? 1)) throw badRequest(code, `${key} is required`);
  if (s.length > opts.max) throw badRequest(code, `${key} must be at most ${opts.max} characters`);
  return s;
}

/** Optional string: undefined when absent, otherwise validated like reqString. */
export function optString(body: Body, key: string, opts: StrOpts): string | undefined {
  if (body[key] === undefined) return undefined;
  return reqString(body, key, { ...opts, min: opts.min ?? 0 });
}

/** Optional http(s) URL; null/"" clears it. Returns undefined when absent. */
export function optUrl(body: Body, key: string): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return parseUrl(v, key);
}

export function parseUrl(v: unknown, key = "sourceUrl"): string {
  if (typeof v !== "string" || v.length > 2048) throw badRequest("invalid_input", `${key} must be a URL`);
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return u.toString();
  } catch {
    throw badRequest("invalid_input", `${key} must be an http(s) URL`);
  }
}

export const PIN_RE = /^\d{6,12}$/;

export function pinField(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !PIN_RE.test(v)) {
    throw new HttpError(400, "invalid_pin", "PIN must be 6 to 12 digits");
  }
  return v;
}
