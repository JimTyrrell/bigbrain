#!/usr/bin/env node
// BigBrain live validator (R7.1). Plain Node >= 22 ESM, no dependencies.
//
//   BIGBRAIN_URL=https://bigbrain.designaticlabs.com BIGBRAIN_PIN=xxxxxx node validate/validate.mjs [--skip-lockout]
//
// Prints one line per check (PASS|FAIL|SKIP  R#.#  description (ms)), a summary, and exits
// non-zero if anything FAILed. Everything it creates (a throwaway brain, conversations on the
// seeded brains) is removed in a finally block. The PIN is read from the environment and never
// printed. The lockout check runs last (it locks login for this IP for 15 minutes unless the
// KV key is cleared) and can be skipped with --skip-lockout.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BIGBRAIN_URL ?? "https://bigbrain.designaticlabs.com").replace(/\/+$/, "");
const PIN = process.env.BIGBRAIN_PIN ?? "";
const SKIP_LOCKOUT = process.argv.includes("--skip-lockout");

const SEEDED = {
  hormozi: { name: "Alex Hormozi", question: "What does Alex Hormozi say about making offers?" },
  harrison: { name: "Dan Harrison", question: "What are the three things a coaching business needs?" },
};
const MODELS = ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/openai/gpt-oss-120b", "@cf/deepseek-ai/deepseek-v4-pro-0813"];
const INDEX_TIMEOUT_MS = 120_000;
const OFF_TOPIC = "What is the boiling point of tungsten?";

if (!PIN) {
  console.error("BIGBRAIN_PIN is required (read from the environment; it is never printed).");
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------------------------

class Skip extends Error {}
const results = [];
const notes = []; // extra lines for the summary (timings, quote stats)

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const skip = (why) => {
  throw new Skip(why);
};

async function check(id, name, fn) {
  const t0 = Date.now();
  let status = "PASS";
  let detail = "";
  try {
    const out = await fn();
    if (typeof out === "string") detail = out;
  } catch (err) {
    status = err instanceof Skip ? "SKIP" : "FAIL";
    detail = err?.message ?? String(err);
  }
  const ms = Date.now() - t0;
  results.push({ id, name, status, ms, detail });
  const line = `${status.padEnd(4)}  ${id.padEnd(16)} ${name} (${ms} ms)`;
  console.log(detail ? `${line}\n      -> ${detail.split("\n")[0].slice(0, 400)}` : line);
  return status === "PASS";
}

// ---------------------------------------------------------------------------------------------
// HTTP: cookie-jar fetch wrapper
// ---------------------------------------------------------------------------------------------

const jar = new Map(); // name -> value

function storeCookies(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const maxAge = /max-age=(-?\d+)/i.exec(raw)?.[1];
    const expires = /expires=([^;]+)/i.exec(raw)?.[1];
    const gone = value === "" || (maxAge !== undefined && Number(maxAge) <= 0) || (expires && Date.parse(expires) < Date.now());
    if (gone) jar.delete(name);
    else jar.set(name, value);
  }
}

/** fetch() with the cookie jar. opts.json -> JSON body, opts.form -> FormData body, opts.noCookies -> anonymous. */
async function http(method, path, opts = {}) {
  const headers = new Headers(opts.headers ?? {});
  if (!opts.noCookies && jar.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  let body;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;
  else if (opts.body !== undefined) body = opts.body;
  const res = await fetch(BASE + path, { method, headers, body, redirect: "manual", signal: opts.signal });
  storeCookies(res);
  return res;
}

/** JSON convenience: returns { status, headers, body } where body is parsed JSON, text, or null. */
async function api(method, path, opts = {}) {
  const res = await http(method, path, opts);
  const type = res.headers.get("content-type") ?? "";
  let body = null;
  if (res.status !== 204) {
    const text = await res.text();
    body = type.includes("json") && text ? JSON.parse(text) : text;
  }
  return { status: res.status, headers: res.headers, body };
}

function expectStatus(r, want, what) {
  assert(r.status === want, `${what}: expected ${want}, got ${r.status} ${typeof r.body === "string" ? r.body.slice(0, 200) : JSON.stringify(r.body)?.slice(0, 200)}`);
}

async function login(pin = PIN) {
  const r = await api("POST", "/api/auth/login", { json: { pin } });
  expectStatus(r, 204, "login");
  assert(jar.has("bb_session"), "login did not set bb_session");
}

// ---------------------------------------------------------------------------------------------
// SSE reader
// ---------------------------------------------------------------------------------------------

/** Reads a text/event-stream response into [{ event, data, at }], where `at` is ms since the request started. */
async function readSse(res, t0) {
  if (!res.ok) throw new Error(`stream request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  assert((res.headers.get("content-type") ?? "").includes("text/event-stream"), `not an SSE response: ${res.headers.get("content-type")}`);
  const events = [];
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (block) => {
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const raw = data.join("\n");
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    events.push({ event, data: parsed, at: Date.now() - t0 });
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      flush(buf.slice(0, i).replace(/\r/g, ""));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) flush(buf.replace(/\r/g, ""));
  return events;
}

/** Sends a chat message and returns the parsed stream plus derived fields. */
async function chat(conversationId, content, model) {
  const t0 = Date.now();
  const res = await http("POST", `/api/conversations/${conversationId}/messages`, { json: model ? { content, model } : { content } });
  const events = await readSse(res, t0);
  const byType = (t) => events.filter((e) => e.event === t);
  const tokens = byType("token");
  const error = byType("error")[0]?.data;
  return {
    events,
    meta: byType("meta")[0]?.data,
    citations: byType("citations")[0]?.data?.citations ?? [],
    tokens,
    text: tokens.map((e) => e.data?.text ?? "").join(""),
    done: byType("done")[0]?.data?.message,
    error,
    ttft: tokens[0]?.at ?? null,
    total: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------------------------
// Verbatim-quote analysis
// ---------------------------------------------------------------------------------------------

const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\[\d+\]/g, " ") // inline [n] citation markers
    .replace(/[…]|\.\.\./g, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ") // punctuation-insensitive: the words must match
    .replace(/\s+/g, " ")
    .trim();

/** Every double-quoted span of >= minWords words in `text`. */
function extractQuotes(text, minWords = 6) {
  const out = [];
  const re = /["“]([^"“”]{6,}?)["”]/g;
  let m;
  while ((m = re.exec(text))) {
    const q = normalise(m[1]);
    if (q.split(" ").length >= minWords) out.push(q);
  }
  return out;
}

function quoteStats(answer, citations) {
  const quotes = extractQuotes(answer);
  const excerpts = citations.map((c) => normalise(c.excerpt ?? ""));
  const verbatim = quotes.filter((q) => excerpts.some((e) => e.includes(q)));
  return { quotes, verbatim, notVerbatim: quotes.filter((q) => !verbatim.includes(q)) };
}

// ---------------------------------------------------------------------------------------------
// Helpers for documents / conversations
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIndexed(docId, timeoutMs = INDEX_TIMEOUT_MS) {
  const t0 = Date.now();
  let doc;
  while (Date.now() - t0 < timeoutMs) {
    const r = await api("GET", `/api/documents/${docId}`);
    expectStatus(r, 200, "get document");
    doc = r.body.document;
    if (doc.indexStatus !== "pending") break;
    await sleep(2000);
  }
  assert(doc && doc.indexStatus === "indexed", `document ${docId} not indexed after ${Math.round((Date.now() - t0) / 1000)} s: status=${doc?.indexStatus} error=${doc?.indexError}`);
  assert(doc.chunkCount > 0, "indexed document has chunkCount 0");
  return doc;
}

async function waitTitle(brainId, convId, timeoutMs = 20_000) {
  const t0 = Date.now();
  let conv;
  while (Date.now() - t0 < timeoutMs) {
    const r = await api("GET", `/api/brains/${brainId}/conversations`);
    expectStatus(r, 200, "list conversations");
    conv = r.body.conversations.find((c) => c.id === convId);
    if (conv && conv.title !== "New chat") return conv;
    await sleep(1500);
  }
  assert(conv, "conversation missing from list");
  assert(conv.title !== "New chat", `title still "New chat" after ${timeoutMs / 1000} s`);
  return conv;
}

/** A minimal single-page PDF with the given text (Helvetica), built by hand so no package is needed. */
function tinyPdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // content stream, filled below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 72 700 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const SAMPLE_MD = `# Validator transcript

[00:12] This is a throwaway validator document about the migration of zebras across the Serengeti plains.

[01:04] Zebras travel in large herds and follow the rains, which is why the validator mentions them here.

[12:34] The final paragraph exists so the chunker sees several timestamped paragraphs in one document.
`;

// ---------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------

const state = { brainId: null, convIds: [], loggedIn: false };
const ttft = {}; // model -> ms
const quoteTotals = { quotes: 0, verbatim: 0 };

async function cleanup() {
  try {
    if (!state.loggedIn) return;
    for (const id of state.convIds.splice(0)) await api("DELETE", `/api/conversations/${id}`).catch(() => {});
    if (state.brainId) {
      await api("DELETE", `/api/brains/${state.brainId}`).catch(() => {});
      state.brainId = null;
    }
  } catch (err) {
    console.error("cleanup problem:", err?.message ?? err);
  }
}

async function main() {
  console.log(`BigBrain validator -> ${BASE}\n`);

  // ----- R1.2 platform -----
  await check("R1.2", "GET /api/health over TLS (valid certificate)", async () => {
    const r = await api("GET", "/api/health", { noCookies: true });
    assert(BASE.startsWith("https://"), "BIGBRAIN_URL must be https");
    expectStatus(r, 200, "health");
    assert(r.body?.ok === true && typeof r.body.version === "string", `unexpected body ${JSON.stringify(r.body)}`);
    return `version ${r.body.version}`;
  });
  await check("R1.2", "GET / returns the SPA shell", async () => {
    const r = await api("GET", "/", { noCookies: true });
    expectStatus(r, 200, "GET /");
    assert((r.headers.get("content-type") ?? "").includes("text/html"), `content-type ${r.headers.get("content-type")}`);
    assert(/<div id="root">/.test(r.body) && /<title>BigBrain<\/title>/.test(r.body), "shell markup missing (#root / title)");
    assert(/<script[^>]+type="module"[^>]+src="\/assets\//.test(r.body), "built module script not referenced");
  });

  // ----- R2.8 security headers -----
  for (const path of ["/", "/api/health"]) {
    await check("R2.8", `security headers on ${path}`, async () => {
      const r = await api("GET", path, { noCookies: true });
      const h = (k) => r.headers.get(k) ?? "";
      const missing = [];
      if (!/default-src 'self'/.test(h("content-security-policy")) || !/frame-ancestors 'none'/.test(h("content-security-policy"))) missing.push("CSP");
      if (h("x-frame-options").toUpperCase() !== "DENY") missing.push("X-Frame-Options");
      if (h("x-content-type-options").toLowerCase() !== "nosniff") missing.push("X-Content-Type-Options");
      if (!h("referrer-policy")) missing.push("Referrer-Policy");
      if (!h("permissions-policy")) missing.push("Permissions-Policy");
      assert(!missing.length, `missing/incorrect: ${missing.join(", ")}`);
    });
  }

  // ----- R2.1 auth required -----
  await check("R2.1", "data routes return 401 without a session", async () => {
    const routes = [
      ["GET", "/api/brains"],
      ["POST", "/api/brains", { json: { name: "x" } }],
      ["GET", "/api/brains/nope/documents"],
      ["GET", "/api/documents/nope"],
      ["GET", "/api/brains/nope/conversations"],
      ["GET", "/api/conversations/nope"],
      ["POST", "/api/conversations/nope/messages", { json: { content: "hi" } }],
      ["GET", "/api/models"],
      ["GET", "/api/settings"],
      ["POST", "/api/transcribe"],
      ["POST", "/api/auth/change-pin", { json: { currentPin: "000000", newPin: "000000" } }],
    ];
    const bad = [];
    for (const [method, path, opts] of routes) {
      const r = await api(method, path, { ...(opts ?? {}), noCookies: true });
      if (r.status !== 401 || r.body?.error?.code !== "unauthorized") bad.push(`${method} ${path} -> ${r.status}`);
    }
    assert(!bad.length, bad.join("; "));
    return `${routes.length} routes`;
  });
  await check("R2.1", "status reports pinSet=true, authenticated=false anonymously", async () => {
    const r = await api("GET", "/api/auth/status", { noCookies: true });
    expectStatus(r, 200, "status");
    assert(r.body.pinSet === true, "pinSet should be true (a PIN is set)");
    assert(r.body.authenticated === false, "authenticated should be false without a cookie");
  });

  // ----- R2.2 setup -----
  await check("R2.2", "POST /auth/setup is 409 once a PIN exists", async () => {
    const r = await api("POST", "/api/auth/setup", { json: { pin: "123456" }, noCookies: true });
    expectStatus(r, 409, "setup");
    assert(r.body?.error?.code === "pin_already_set", `code ${r.body?.error?.code}`);
  });

  // ----- R2.3 login / logout -----
  await check("R2.3", "login sets HttpOnly; Secure; SameSite=Strict bb_session cookie", async () => {
    const res = await http("POST", "/api/auth/login", { json: { pin: PIN } });
    assert(res.status === 204, `login expected 204, got ${res.status}`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("bb_session="));
    assert(cookie, "no bb_session Set-Cookie");
    const flags = cookie.toLowerCase();
    for (const f of ["httponly", "secure", "samesite=strict", "path=/"]) assert(flags.includes(f), `cookie lacks ${f}: ${cookie.replace(/^bb_session=[^;]+/, "bb_session=<redacted>")}`);
    const maxAge = Number(/max-age=(\d+)/.exec(flags)?.[1] ?? 0);
    assert(maxAge >= 29 * 86400 || /expires=/.test(flags), "cookie has no ~30-day lifetime");
    state.loggedIn = true;
  });
  await check("R2.3", "status shows authenticated with the cookie", async () => {
    const r = await api("GET", "/api/auth/status");
    expectStatus(r, 200, "status");
    assert(r.body.authenticated === true, `authenticated=${r.body.authenticated}`);
  });
  await check("R2.3", "wrong PIN -> 401 generic error", async () => {
    const r = await api("POST", "/api/auth/login", { json: { pin: "000000" }, noCookies: true });
    expectStatus(r, 401, "bad login");
    assert(r.body?.error?.code === "invalid_credentials", `code ${r.body?.error?.code}`);
    // Clear the failure counter so it does not bleed into the lockout check.
    await login();
  });
  await check("R2.3", "a forged cookie is rejected", async () => {
    const r = await api("GET", "/api/brains", { noCookies: true, headers: { Cookie: "bb_session=forged.token" } });
    expectStatus(r, 401, "forged cookie");
  });
  await check("R2.3", "logout clears the cookie; subsequent request is 401", async () => {
    const res = await http("POST", "/api/auth/logout");
    assert(res.status === 204, `logout ${res.status}`);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith("bb_session="));
    assert(cleared && /max-age=0|expires=/i.test(cleared), "logout did not expire the cookie");
    assert(!jar.has("bb_session"), "jar still holds bb_session after logout");
    const r = await api("GET", "/api/brains");
    expectStatus(r, 401, "after logout");
    await login();
  });

  // ----- R2.5 change PIN -----
  await check("R2.2", "change-pin rejects a malformed new PIN (400 invalid_pin)", async () => {
    const r = await api("POST", "/api/auth/change-pin", { json: { currentPin: PIN, newPin: "12ab" } });
    expectStatus(r, 400, "malformed pin");
    assert(r.body?.error?.code === "invalid_pin", `code ${r.body?.error?.code}`);
  });
  const TEMP_PIN = PIN === "999999" ? "888888" : "999999";
  let pinChanged = false;
  await check("R2.5", "change-pin: wrong current -> 401, correct -> 204, new PIN logs in, then revert", async () => {
    const bad = await api("POST", "/api/auth/change-pin", { json: { currentPin: "000000", newPin: TEMP_PIN } });
    expectStatus(bad, 401, "wrong current");
    const ok = await api("POST", "/api/auth/change-pin", { json: { currentPin: PIN, newPin: TEMP_PIN } });
    expectStatus(ok, 204, "change-pin");
    pinChanged = true;
    const old = await api("POST", "/api/auth/login", { json: { pin: PIN }, noCookies: true });
    expectStatus(old, 401, "old PIN after change");
    jar.clear();
    await login(TEMP_PIN);
    const back = await api("POST", "/api/auth/change-pin", { json: { currentPin: TEMP_PIN, newPin: PIN } });
    expectStatus(back, 204, "change back");
    pinChanged = false;
    jar.clear();
    await login();
  });
  if (pinChanged) {
    // Belt and braces: never leave the owner with a different PIN.
    await api("POST", "/api/auth/change-pin", { json: { currentPin: TEMP_PIN, newPin: PIN } }).catch(() => {});
    jar.clear();
    await login().catch(() => {});
  }

  // ----- R3.1 / R3.2 brains -----
  const brainName = `zz-validator-${Date.now()}`;
  await check("R3.1/R3.2", "create brain with description", async () => {
    const r = await api("POST", "/api/brains", { json: { name: brainName, description: "Throwaway validator brain (zebra facts)" } });
    expectStatus(r, 201, "create brain");
    const b = r.body.brain;
    assert(b?.id && b.name === brainName && b.description === "Throwaway validator brain (zebra facts)", `unexpected brain ${JSON.stringify(b)}`);
    assert(b.documentCount === 0 && b.conversationCount === 0, "counts should start at 0");
    state.brainId = b.id;
  });
  await check("R3.1", "list brains includes new brain and both seeded brains", async () => {
    const r = await api("GET", "/api/brains");
    expectStatus(r, 200, "list");
    const names = r.body.brains.map((b) => b.name);
    assert(names.includes(brainName), "new brain missing");
    for (const s of Object.values(SEEDED)) {
      const b = r.body.brains.find((x) => x.name === s.name);
      assert(b, `seeded brain "${s.name}" missing`);
      s.id = b.id;
      s.documentCount = b.documentCount;
    }
    return `Hormozi ${SEEDED.hormozi.documentCount} docs, Harrison ${SEEDED.harrison.documentCount} docs`;
  });
  await check("R3.1", "get + rename brain", async () => {
    const r = await api("GET", `/api/brains/${state.brainId}`);
    expectStatus(r, 200, "get brain");
    const p = await api("PATCH", `/api/brains/${state.brainId}`, { json: { name: `${brainName}-renamed` } });
    expectStatus(p, 200, "rename");
    assert(p.body.brain.name === `${brainName}-renamed`, "rename not applied");
    assert(p.body.brain.description === "Throwaway validator brain (zebra facts)", "description lost on rename");
    const bad = await api("POST", "/api/brains", { json: { name: "" } });
    expectStatus(bad, 400, "empty name validation");
  });

  // ----- R3.3 – R3.6 documents -----
  let docId = null;
  await check("R3.3/R3.5", "paste markdown doc with [mm:ss] markers + sourceUrl -> pending -> indexed", async () => {
    const r = await api("POST", `/api/brains/${state.brainId}/documents`, {
      json: { title: "Validator transcript", content: SAMPLE_MD, sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", sourceType: "transcript" },
    });
    expectStatus(r, 201, "create doc");
    const d = r.body.document;
    assert(d.indexStatus === "pending", `initial status ${d.indexStatus}`);
    assert(d.sourceUrl === "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "sourceUrl not stored");
    docId = d.id;
    const t0 = Date.now();
    const indexed = await waitIndexed(docId);
    return `indexed in ${Math.round((Date.now() - t0) / 1000)} s, ${indexed.chunkCount} chunk(s)`;
  });
  await check("R3.4", "GET document returns content; list omits it", async () => {
    const r = await api("GET", `/api/documents/${docId}`);
    expectStatus(r, 200, "get doc");
    assert(r.body.document.content === SAMPLE_MD, "content differs from what was pasted");
    const l = await api("GET", `/api/brains/${state.brainId}/documents`);
    expectStatus(l, 200, "list docs");
    const row = l.body.documents.find((d) => d.id === docId);
    assert(row && row.content === undefined, "list should not include content");
    const b = await api("GET", `/api/brains/${state.brainId}`);
    assert(b.body.brain.documentCount === 1, `brain documentCount ${b.body.brain.documentCount}`);
  });
  await check("R3.6", "transcript chunks carry timestamps (citation when chatting the throwaway brain)", async () => {
    // Vectorize upserts are eventually consistent: a doc can report "indexed" a few seconds before
    // its vectors are queryable. Retry for up to 60 s and report the observed lag.
    const t0 = Date.now();
    let out;
    let attempts = 0;
    while (Date.now() - t0 < 240_000) {
      const c = await api("POST", `/api/brains/${state.brainId}/conversations`, { json: {} });
      expectStatus(c, 201, "create conv");
      attempts++;
      out = await chat(c.body.conversation.id, "Where do the zebras migrate?");
      assert(!out.error, `stream error ${JSON.stringify(out.error)}`);
      if (out.citations.length > 0) break;
      await sleep(5000);
    }
    assert(out.citations.length > 0, `no citations from the throwaway doc after ${attempts} attempts / ${Math.round((Date.now() - t0) / 1000)} s`);
    const ts = out.citations.find((x) => x.timestamp && x.link?.includes("&t="));
    assert(ts, `no citation with timestamp+link: ${JSON.stringify(out.citations.map((x) => [x.timestamp, x.link]))}`);
    return `timestamp ${ts.timestamp} -> ${ts.link} (queryable after ${attempts} attempt(s), ${Math.round((Date.now() - t0) / 1000)} s)`;
  });
  await check("R3.4", "PATCH content re-indexes (pending -> indexed)", async () => {
    const edited = `${SAMPLE_MD}\n[20:00] An appended paragraph after editing.\n`;
    const r = await api("PATCH", `/api/documents/${docId}`, { json: { content: edited, title: "Validator transcript (edited)" } });
    expectStatus(r, 200, "patch");
    assert(r.body.document.indexStatus === "pending", `status after edit ${r.body.document.indexStatus}`);
    assert(r.body.document.title === "Validator transcript (edited)", "title not updated");
    const d = await waitIndexed(docId);
    const g = await api("GET", `/api/documents/${docId}`);
    assert(g.body.document.content === edited, "edited content not stored");
    return `${d.chunkCount} chunk(s)`;
  });
  await check("R3.4", "POST /reindex -> 202 and re-indexes", async () => {
    const r = await api("POST", `/api/documents/${docId}/reindex`);
    expectStatus(r, 202, "reindex");
    await waitIndexed(docId);
  });
  await check("R3.3", "upload .txt via multipart -> indexed", async () => {
    const form = new FormData();
    form.append("file", new Blob(["Plain text upload from the validator. Giraffes are tall.\n"], { type: "text/plain" }), "giraffes.txt");
    form.append("title", "Giraffe note");
    const r = await api("POST", `/api/brains/${state.brainId}/documents`, { form });
    expectStatus(r, 201, "upload txt");
    assert(r.body.document.title === "Giraffe note" && r.body.document.sourceType === "upload", `unexpected ${JSON.stringify(r.body.document)}`);
    const d = await waitIndexed(r.body.document.id);
    return `${d.chunkCount} chunk(s)`;
  });
  await check("R3.3", "upload tiny PDF -> toMarkdown -> indexed", async () => {
    const form = new FormData();
    form.append("file", new Blob([tinyPdf("Validator PDF about zebra migration patterns")], { type: "application/pdf" }), "zebras.pdf");
    const r = await api("POST", `/api/brains/${state.brainId}/documents`, { form });
    expectStatus(r, 201, "upload pdf");
    const g = await api("GET", `/api/documents/${r.body.document.id}`);
    assert(/zebra/i.test(g.body.document.content), `converted content lacks expected text: ${g.body.document.content.slice(0, 120)}`);
    const d = await waitIndexed(r.body.document.id);
    return `${d.chunkCount} chunk(s); title "${d.title}"`;
  });
  await check("R3.3", "upload .exe -> 415 unsupported_type", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("MZ\0\0junk")], { type: "application/octet-stream" }), "virus.exe");
    const r = await api("POST", `/api/brains/${state.brainId}/documents`, { form });
    expectStatus(r, 415, "exe upload");
    assert(r.body?.error?.code === "unsupported_type", `code ${r.body?.error?.code}`);
  });
  await check("R3.4", "delete document -> 204, then 404", async () => {
    const r = await api("DELETE", `/api/documents/${docId}`);
    expectStatus(r, 204, "delete doc");
    const g = await api("GET", `/api/documents/${docId}`);
    expectStatus(g, 404, "get deleted doc");
  });

  // ----- R3.6 / R4.6 / R5.1 / R5.4 chat on the seeded brains -----
  async function seededChat(key) {
    const s = SEEDED[key];
    assert(s.id, `seeded brain ${s.name} not found`);
    const c = await api("POST", `/api/brains/${s.id}/conversations`, { json: {} });
    expectStatus(c, 201, "create conversation");
    const convId = c.body.conversation.id;
    state.convIds.push(convId);
    const out = await chat(convId, s.question);
    assert(!out.error, `stream error ${JSON.stringify(out.error)}`);
    assert(out.meta?.userMessageId && out.meta.assistantMessageId && out.meta.model, `bad meta ${JSON.stringify(out.meta)}`);
    assert(out.citations.length > 0, "citations event empty");
    assert(out.tokens.length >= 1, "no token events");
    assert(out.done?.id === out.meta.assistantMessageId && out.done.role === "assistant", `bad done ${JSON.stringify(out.done)?.slice(0, 200)}`);
    assert(out.done.content === out.text, "saved content differs from streamed tokens");
    const ts = out.citations.find((x) => x.timestamp && x.link?.includes("&t="));
    assert(ts, `no citation with timestamp and &t= link: ${JSON.stringify(out.citations.map((x) => [x.timestamp, x.link]))}`);
    const saved = await api("GET", `/api/conversations/${convId}`);
    expectStatus(saved, 200, "get conversation");
    assert(saved.body.messages.length === 2, `expected 2 saved messages, got ${saved.body.messages.length}`);
    assert(Array.isArray(saved.body.messages[1].citations) && saved.body.messages[1].citations.length > 0, "saved assistant message has no citations");
    const stats = quoteStats(out.text, out.citations);
    quoteTotals.quotes += stats.quotes.length;
    quoteTotals.verbatim += stats.verbatim.length;
    notes.push(`${s.name}: ${stats.quotes.length} quoted span(s) >= 6 words, ${stats.verbatim.length} verbatim in excerpts, ${stats.notVerbatim.length} not; ttft ${out.ttft} ms, total ${out.total} ms, ${out.citations.length} citations, ${out.done.citations.length} cited`);
    for (const q of stats.notVerbatim) notes.push(`    not verbatim (${s.name}): "${q.slice(0, 120)}"`);
    return { convId, out, stats };
  }

  let hormozi = null;
  await check("R4.6/R5.4", "Hormozi: SSE meta -> citations -> tokens -> done; citation has timestamp + &t= link", async () => {
    hormozi = await seededChat("hormozi");
    return `${hormozi.out.citations.length} citations, ${hormozi.out.tokens.length} tokens, ttft ${hormozi.out.ttft} ms`;
  });
  await check("R5.1", "Hormozi: at least one quoted span appears verbatim in a citation excerpt", async () => {
    assert(hormozi, "chat failed");
    const { quotes, verbatim } = hormozi.stats;
    assert(quotes.length > 0, `answer contains no quoted span of >= 6 words:\n${hormozi.out.text.slice(0, 300)}`);
    assert(verbatim.length > 0, `none of ${quotes.length} quotes found verbatim in excerpts; first: "${quotes[0]}"`);
    return `${verbatim.length}/${quotes.length} verbatim`;
  });
  await check("R5.2", "Hormozi: answer has a 'What ... said' section and [n] citation markers", async () => {
    assert(hormozi, "chat failed");
    assert(/what .{0,40}said/i.test(hormozi.out.text), "no 'What <name> said' heading");
    assert(/\[\d+\]/.test(hormozi.out.text), "no [n] citation markers in the reply");
  });
  let harrison = null;
  await check("R4.6/R5.4", "Harrison: SSE stream + timestamped citation", async () => {
    harrison = await seededChat("harrison");
    return `${harrison.out.citations.length} citations, ${harrison.out.tokens.length} tokens, ttft ${harrison.out.ttft} ms`;
  });
  await check("R5.1", "Harrison: at least one quoted span appears verbatim in a citation excerpt", async () => {
    assert(harrison, "chat failed");
    const { quotes, verbatim } = harrison.stats;
    assert(quotes.length > 0, `answer contains no quoted span of >= 6 words:\n${harrison.out.text.slice(0, 300)}`);
    assert(verbatim.length > 0, `none of ${quotes.length} quotes found verbatim in excerpts; first: "${quotes[0]}"`);
    return `${verbatim.length}/${quotes.length} verbatim`;
  });
  await check("R4.6", "retrieval is scoped to the brain (Harrison citations only cite Harrison documents)", async () => {
    assert(harrison, "chat failed");
    const docs = await api("GET", `/api/brains/${SEEDED.harrison.id}/documents`);
    const ids = new Set(docs.body.documents.map((d) => d.id));
    const foreign = harrison.out.citations.filter((c) => !ids.has(c.documentId));
    assert(!foreign.length, `citations from other brains: ${foreign.map((c) => c.documentTitle).join(", ")}`);
    assert(harrison.out.citations.length <= 8, `more than 8 chunks retrieved (${harrison.out.citations.length})`);
  });

  // ----- R4.2 conversations -----
  await check("R4.2", "conversation gets an auto title (not 'New chat') within 20 s", async () => {
    assert(hormozi, "chat failed");
    const conv = await waitTitle(SEEDED.hormozi.id, hormozi.convId);
    assert(conv.messageCount === 2, `messageCount ${conv.messageCount}`);
    return `"${conv.title}"`;
  });
  await check("R4.2", "rename conversation", async () => {
    const r = await api("PATCH", `/api/conversations/${hormozi.convId}`, { json: { title: "Validator renamed" } });
    expectStatus(r, 200, "rename");
    assert(r.body.conversation.title === "Validator renamed", "title not applied");
    const l = await api("GET", `/api/brains/${SEEDED.hormozi.id}/conversations`);
    assert(l.body.conversations[0]?.id === hormozi.convId, "renamed conversation is not newest-first in the list");
  });
  await check("R4.2", "delete one conversation -> 204, then 404", async () => {
    assert(harrison, "chat failed");
    const r = await api("DELETE", `/api/conversations/${harrison.convId}`);
    expectStatus(r, 204, "delete");
    state.convIds = state.convIds.filter((id) => id !== harrison.convId);
    const g = await api("GET", `/api/conversations/${harrison.convId}`);
    expectStatus(g, 404, "get deleted");
  });
  await check("R4.2", "delete all conversations on the throwaway brain", async () => {
    for (let i = 0; i < 2; i++) expectStatus(await api("POST", `/api/brains/${state.brainId}/conversations`, { json: {} }), 201, "create");
    const before = await api("GET", `/api/brains/${state.brainId}/conversations`);
    assert(before.body.conversations.length >= 2, "setup failed");
    const r = await api("DELETE", `/api/brains/${state.brainId}/conversations`);
    expectStatus(r, 204, "delete all");
    const after = await api("GET", `/api/brains/${state.brainId}/conversations`);
    assert(after.body.conversations.length === 0, `${after.body.conversations.length} conversations remain`);
    const b = await api("GET", `/api/brains/${state.brainId}`);
    assert(b.body.brain.conversationCount === 0, "brain conversationCount not 0");
  });

  // ----- R4.4 / R4.5 models -----
  await check("R4.4", "GET /api/models lists the curated models with the default", async () => {
    const r = await api("GET", "/api/models");
    expectStatus(r, 200, "models");
    const ids = r.body.models.map((m) => m.id);
    for (const m of MODELS) assert(ids.includes(m), `missing ${m}`);
    assert(r.body.defaultModel && ids.includes(r.body.defaultModel), `defaultModel ${r.body.defaultModel}`);
    for (const m of r.body.models) assert(m.label && m.vendor && m.contextWindow > 0 && m.note, `incomplete ModelInfo ${JSON.stringify(m)}`);
    const s = await api("GET", "/api/settings");
    assert(s.body.defaultModel === r.body.defaultModel, "settings/models default mismatch");
    const bad = await api("PUT", "/api/settings", { json: { defaultModel: "@cf/not/a-model" } });
    expectStatus(bad, 400, "unknown default model");
    return `${ids.length} models, default ${r.body.defaultModel}`;
  });
  for (const model of MODELS) {
    await check("R4.4/R4.5", `stream with ${model}`, async () => {
      const c = await api("POST", `/api/brains/${SEEDED.hormozi.id}/conversations`, { json: { model } });
      expectStatus(c, 201, "create conv with model");
      assert(c.body.conversation.model === model, "conversation model not stored");
      const convId = c.body.conversation.id;
      state.convIds.push(convId);
      const out = await chat(convId, SEEDED.hormozi.question, model);
      assert(!out.error, `stream error ${JSON.stringify(out.error)}`);
      assert(out.meta?.model === model, `meta model ${out.meta?.model}`);
      assert(out.tokens.length >= 1, "no tokens");
      assert(out.done?.model === model, `saved message model ${out.done?.model}`);
      ttft[model] = out.ttft;
      const stats = quoteStats(out.text, out.citations);
      quoteTotals.quotes += stats.quotes.length;
      quoteTotals.verbatim += stats.verbatim.length;
      notes.push(`${model}: ttft ${out.ttft} ms, total ${out.total} ms, ${out.tokens.length} tokens, quotes ${stats.verbatim.length}/${stats.quotes.length} verbatim`);
      for (const q of stats.notVerbatim) notes.push(`    not verbatim (${model}): "${q.slice(0, 120)}"`);
      return `ttft ${out.ttft} ms, ${out.tokens.length} tokens, ${out.text.length} chars`;
    });
  }
  await check("R4.5", "switch model via PATCH on the conversation, then message without `model` uses it", async () => {
    const convId = state.convIds[state.convIds.length - 1];
    const target = MODELS[0];
    const p = await api("PATCH", `/api/conversations/${convId}`, { json: { model: target } });
    expectStatus(p, 200, "patch model");
    assert(p.body.conversation.model === target, "model not updated");
    const out = await chat(convId, "In one sentence, what is the main idea?");
    assert(!out.error, `stream error ${JSON.stringify(out.error)}`);
    assert(out.meta?.model === target && out.done?.model === target, `model used ${out.meta?.model}/${out.done?.model}`);
    const bad = await api("POST", `/api/conversations/${convId}/messages`, { json: { content: "x", model: "@cf/not/real" } });
    expectStatus(bad, 400, "unknown model");
  });

  // ----- R4.3 voice -----
  for (const name of ["hello.webm", "hello.wav"]) {
    await check("R4.3", `POST /api/transcribe ${name} -> Whisper text mentions Hormozi/offers`, async () => {
      let bytes;
      try {
        bytes = await readFile(join(HERE, "fixtures", name));
      } catch {
        skip(`fixture ${name} missing`);
      }
      const form = new FormData();
      form.append("audio", new Blob([bytes], { type: name.endsWith(".wav") ? "audio/wav" : "audio/webm" }), name);
      const r = await api("POST", "/api/transcribe", { form });
      expectStatus(r, 200, "transcribe");
      const text = r.body?.text ?? "";
      assert(/hormozi|offers/i.test(text), `transcript did not match: "${text}"`);
      return `"${text}"`;
    });
  }
  await check("R4.3", "transcribe rejects non-multipart and empty audio", async () => {
    const r = await api("POST", "/api/transcribe", { json: { audio: "x" } });
    expectStatus(r, 415, "json body");
    const form = new FormData();
    form.append("audio", new Blob([], { type: "audio/webm" }), "empty.webm");
    expectStatus(await api("POST", "/api/transcribe", { form }), 400, "empty audio");
  });

  // ----- R5.3 off-topic honesty -----
  await check("R5.3", "off-topic question: answer admits the material does not cover it and invents no quotes", async () => {
    const c = await api("POST", `/api/brains/${SEEDED.hormozi.id}/conversations`, { json: {} });
    expectStatus(c, 201, "create conv");
    state.convIds.push(c.body.conversation.id);
    const out = await chat(c.body.conversation.id, OFF_TOPIC);
    assert(!out.error, `stream error ${JSON.stringify(out.error)}`);
    const text = out.text;
    const admits = /(doesn't|does not|don't|do not|no relevant|not covered|not address|nothing in|not contain|not mention|not discuss|no information|not include|isn't covered|outside the scope|unable to answer|cannot answer|can't answer|not found in)/i.test(text);
    const stats = quoteStats(text, out.citations);
    notes.push(`off-topic: ${stats.quotes.length} quoted span(s), ${stats.notVerbatim.length} not in excerpts; ttft ${out.ttft} ms`);
    assert(admits, `answer does not admit the gap:\n${text.slice(0, 400)}`);
    assert(stats.notVerbatim.length === 0, `fabricated quote(s) not in any excerpt: ${stats.notVerbatim.map((q) => `"${q.slice(0, 80)}"`).join(" | ")}`);
    return text.replace(/\s+/g, " ").slice(0, 140);
  });

  // ----- cleanup our data, then verify the brain cascade -----
  await check("R3.1", "delete brain cascades (documents gone) -> 204, then 404", async () => {
    const docs = await api("GET", `/api/brains/${state.brainId}/documents`);
    const docIds = docs.body.documents.map((d) => d.id);
    const r = await api("DELETE", `/api/brains/${state.brainId}`);
    expectStatus(r, 204, "delete brain");
    const id = state.brainId;
    state.brainId = null;
    expectStatus(await api("GET", `/api/brains/${id}`), 404, "get deleted brain");
    for (const d of docIds) expectStatus(await api("GET", `/api/documents/${d}`), 404, `document ${d} after brain delete`);
    return `${docIds.length} document(s) removed with the brain`;
  });
  await cleanup();
  await check("R4.2", "seeded brains have no validator conversations left", async () => {
    for (const s of Object.values(SEEDED)) {
      const l = await api("GET", `/api/brains/${s.id}/conversations`);
      const mine = l.body.conversations.filter((c) => state.convIds.includes(c.id));
      assert(!mine.length, `${mine.length} validator conversation(s) remain on ${s.name}`);
    }
  });

  // ----- R2.4 lockout (last) -----
  if (SKIP_LOCKOUT) {
    await check("R2.4", "login lockout after 5 failures", async () => skip("--skip-lockout"));
  } else {
    await check("R2.4", "5 wrong PINs -> next login is 429 locked with retryAfterSeconds", async () => {
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await api("POST", "/api/auth/login", { json: { pin: "000000" }, noCookies: true })).status);
      assert(statuses.every((s) => s === 401 || s === 429), `unexpected statuses ${statuses.join(",")}`);
      const locked = await api("POST", "/api/auth/login", { json: { pin: PIN }, noCookies: true });
      expectStatus(locked, 429, "6th attempt (correct PIN while locked)");
      assert(locked.body?.error?.code === "locked", `code ${locked.body?.error?.code}`);
      const retry = locked.body?.error?.retryAfterSeconds ?? locked.body?.retryAfterSeconds;
      assert(Number.isFinite(retry) && retry > 0 && retry <= 900, `retryAfterSeconds ${retry}`);
      assert(locked.headers.get("retry-after"), "no Retry-After header");
      notes.push(`LOCKOUT ACTIVE for this IP (${retry} s). Clear it with:\n    npx wrangler kv key list --namespace-id <BIGBRAIN_KV id> --remote --prefix login_fail:\n    npx wrangler kv key delete --namespace-id <BIGBRAIN_KV id> --remote "login_fail:<ip>"\n  then confirm POST /api/auth/login returns 204 again.`);
      return `locked, retryAfterSeconds=${retry}`;
    });
  }
}

// ---------------------------------------------------------------------------------------------

let exitCode = 0;
try {
  await main();
} catch (err) {
  console.error("\nValidator aborted:", err?.stack ?? err);
  exitCode = 2;
} finally {
  await cleanup();
  if (state.loggedIn) await api("POST", "/api/auth/logout").catch(() => {});
}

const count = (s) => results.filter((r) => r.status === s).length;
console.log("\n==== Summary ====");
if (Object.keys(ttft).length) {
  console.log("Time to first token:");
  for (const [m, ms] of Object.entries(ttft)) console.log(`  ${m.padEnd(48)} ${ms} ms`);
}
if (quoteTotals.quotes) console.log(`Verbatim quotes: ${quoteTotals.verbatim}/${quoteTotals.quotes} quoted spans (>= 6 words) found verbatim in citation excerpts`);
for (const n of notes) console.log(`  ${n}`);
console.log(`\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIP")} skipped (${results.length} checks)`);
for (const r of results.filter((r) => r.status === "FAIL")) console.log(`  FAIL ${r.id} ${r.name}: ${r.detail}`);
process.exit(exitCode || (count("FAIL") ? 1 : 0));
