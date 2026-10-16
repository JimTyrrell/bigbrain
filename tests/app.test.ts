import { describe, expect, it } from "vitest";
import app from "../src/worker/index";
import type { Env } from "../src/worker/env";

/** In-memory KV good enough for the auth routes (no D1/Vectorize/AI needed). */
function makeEnv(): Env {
  const store = new Map<string, string>();
  const KV = {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return {
    KV,
    ASSETS: { fetch: async () => new Response("<!doctype html><title>BigBrain</title>", { headers: { "Content-Type": "text/html" } }) },
    DEFAULT_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  } as unknown as Env;
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function call(env: Env, path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", "203.0.113.7");
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  return app.request(path, { ...init, headers }, env, ctx);
}

const json = (r: Response): Promise<any> => r.json();
const cookieOf = (res: Response) => (res.headers.get("Set-Cookie") ?? "").split(";")[0];
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("app", () => {
  it("health is public and carries security headers", async () => {
    const res = await call(makeEnv(), "/api/health");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, version: "0.1.0" });
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("serves the SPA shell for non-API paths with headers", async () => {
    const res = await call(makeEnv(), "/some/page");
    expect(await res.text()).toContain("BigBrain");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("protects API routes and 404s unknown ones", async () => {
    const env = makeEnv();
    const res = await call(env, "/api/brains");
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });

    const setup = await call(env, "/api/auth/setup", post({ pin: "123456" }));
    const cookie = cookieOf(setup);
    const missing = await call(env, "/api/nope", { cookie });
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.code).toBe("not_found");
  });

  it("status includes PIN reset info with a KV dashboard deep link", async () => {
    const env = makeEnv();
    const generic = await json(await call(env, "/api/auth/status"));
    expect(generic.reset).toEqual({
      kvDashboardUrl: "https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces",
      keys: ["pin_hash", "session_secret"],
    });

    const withId = { ...env, KV_NAMESPACE_ID: "90a350cf2180411c9bb689002d85b7cb" } as Env;
    expect((await json(await call(withId, "/api/auth/status"))).reset).toEqual({
      kvDashboardUrl: "https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces/90a350cf2180411c9bb689002d85b7cb",
      keys: ["pin_hash", "session_secret"],
    });
  });

  it("runs the auth flow: setup, status, login, change PIN, logout", async () => {
    const env = makeEnv();
    expect(await json(await call(env, "/api/auth/status"))).toMatchObject({ pinSet: false, authenticated: false });

    expect((await call(env, "/api/auth/setup", post({ pin: "12" }))).status).toBe(400);
    const setup = await call(env, "/api/auth/setup", post({ pin: "123456" }));
    expect(setup.status).toBe(204);
    const setCookie = setup.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^bb_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\//);
    expect(await env.KV.get("pin_hash")).toMatch(/^pbkdf2\$100000\$/);
    expect((await call(env, "/api/auth/setup", post({ pin: "999999" }))).status).toBe(409);

    let cookie = cookieOf(setup);
    expect(await json(await call(env, "/api/auth/status", { cookie }))).toMatchObject({ pinSet: true, authenticated: true });
    expect((await call(env, "/api/models", { cookie })).status).toBe(200);

    const bad = await call(env, "/api/auth/login", post({ pin: "000000" }));
    expect(bad.status).toBe(401);
    expect((await json(bad)).error.code).toBe("invalid_credentials");
    const good = await call(env, "/api/auth/login", post({ pin: "123456" }));
    expect(good.status).toBe(204);
    cookie = cookieOf(good);

    expect((await call(env, "/api/auth/change-pin", { ...post({ currentPin: "111111", newPin: "7654321" }), cookie })).status).toBe(401);
    const changed = await call(env, "/api/auth/change-pin", { ...post({ currentPin: "123456", newPin: "7654321" }), cookie });
    expect(changed.status).toBe(204);
    // Old sessions are invalidated; the new cookie works.
    expect((await call(env, "/api/models", { cookie })).status).toBe(401);
    cookie = cookieOf(changed);
    expect((await call(env, "/api/models", { cookie })).status).toBe(200);
    expect((await call(env, "/api/auth/login", post({ pin: "7654321" }))).status).toBe(204);

    const out = await call(env, "/api/auth/logout", { method: "POST", cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("locks login after 5 failures", async () => {
    const env = makeEnv();
    await call(env, "/api/auth/setup", post({ pin: "123456" }));
    for (let i = 0; i < 5; i++) expect((await call(env, "/api/auth/login", post({ pin: "000000" }))).status).toBe(401);
    const locked = await call(env, "/api/auth/login", post({ pin: "123456" }));
    expect(locked.status).toBe(429);
    const body = await json(locked);
    expect(body.error.code).toBe("locked");
    expect(body.error.retryAfterSeconds).toBeGreaterThan(800);
  });

  it("validates settings", async () => {
    const env = makeEnv();
    const cookie = cookieOf(await call(env, "/api/auth/setup", post({ pin: "123456" })));
    const bad = await call(env, "/api/settings", { method: "PUT", body: JSON.stringify({ defaultModel: "nope" }), cookie });
    expect(bad.status).toBe(400);
    const ok = await call(env, "/api/settings", { method: "PUT", body: JSON.stringify({ defaultModel: "@cf/openai/gpt-oss-120b" }), cookie });
    expect(await json(ok)).toEqual({ defaultModel: "@cf/openai/gpt-oss-120b" });
    const s = await json(await call(env, "/api/settings", { cookie }));
    expect(s.defaultModel).toBe("@cf/openai/gpt-oss-120b");
    expect(s.models).toHaveLength(9);
  });
});
