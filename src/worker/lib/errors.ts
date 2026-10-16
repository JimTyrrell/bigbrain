import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Throw from any route; rendered as `{ error: { code, message, ...extra } }`. */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}

export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof HttpError) {
    return c.json(errorBody(err.code, err.message, err.extra), err.status);
  }
  console.error("unhandled error", err);
  return c.json(errorBody("internal", "Internal server error"), 500);
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
