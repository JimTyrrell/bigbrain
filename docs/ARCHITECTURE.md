# BigBrain architecture

```
Browser (React SPA, Vite, Tailwind)  ──/api/*──▶  Cloudflare Worker (Hono, TypeScript)
   │ static assets served by the Worker                 │
   │ (dist/web, SPA fallback)                           ├─ AI        Workers AI binding (chat, embeddings, Whisper, toMarkdown)
   │                                                    ├─ DB        D1  (brains, documents, chunks, conversations, messages)
   │                                                    ├─ VECTORIZE Vectorize index bigbrain-vectors (1024-dim cosine, bge-m3)
   │                                                    └─ KV        BIGBRAIN_KV (pin_hash, session_secret, settings, login throttling)
```

## Repo layout
```
src/worker/            Worker source (owned by the backend agent)
  index.ts             Hono app, middleware (auth, security headers, body limit), route mounting, asset fallback
  env.ts               Env type (bindings + vars)
  routes/              auth.ts settings.ts brains.ts documents.ts conversations.ts chat.ts transcribe.ts models.ts
  lib/                 auth.ts (pbkdf2, hmac tokens, throttling) · db.ts (D1 helpers) · chunk.ts · vtt.ts
                       · ingest.ts (toMarkdown + chunk + embed + upsert) · retrieve.ts · models.ts (catalog + adapters)
                       · prompt.ts (system prompt builder) · sse.ts · ids.ts · errors.ts
src/web/               Vite React app (owned by the frontend agent)
  index.html main.tsx App.tsx api/client.ts components/… hooks/… styles.css
migrations/            D1 SQL migrations (0001_init.sql …), applied by `wrangler d1 migrations apply`
scripts/               vtt-to-markdown.mjs, seed.mjs (owned by the seed agent)
seeds/manifest.json    the YouTube sources per brain (committed); seeds/raw + seeds/content are git-ignored
tests/                 vitest (@cloudflare/vitest-pool-workers) unit tests
validate/validate.mjs  end-to-end validator against a live URL (owned by the validator agent)
.github/workflows/     ci.yml (typecheck + test on push/PR). Deploys are done by Workers Builds, not Actions.
```

## D1 schema (migrations/0001_init.sql)
```sql
CREATE TABLE brains (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE documents (id TEXT PRIMARY KEY, brain_id TEXT NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  title TEXT NOT NULL, source_url TEXT, source_type TEXT NOT NULL, mime_type TEXT, bytes INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL, index_status TEXT NOT NULL DEFAULT 'pending', index_error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX documents_brain ON documents(brain_id);
CREATE TABLE chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  brain_id TEXT NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL, timestamp TEXT);
CREATE INDEX chunks_doc ON chunks(document_id);
CREATE TABLE conversations (id TEXT PRIMARY KEY, brain_id TEXT NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  title TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX conversations_brain ON conversations(brain_id, updated_at);
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, citations TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);
```
Enable `PRAGMA foreign_keys = ON` is implicit in D1; still delete children explicitly so
Vectorize vectors are removed too (vector ids are `${documentId}:${idx}`, metadata
`{ brain_id, document_id, idx }`; a metadata index on `brain_id` exists).

## KV keys
`pin_hash` = `pbkdf2$100000$<salt-b64>$<hash-b64>` · `session_secret` = 32 random bytes b64 ·
`settings` = JSON `{ defaultModel }` · `login_fail:<ip>` = JSON `{ count, until }` (TTL 15 min).

## Chat pipeline
1. Save user message. 2. Embed the question with bge-m3 (`{text:[q]}` → `data[0]`).
3. `VECTORIZE.query(vec, { topK: 8, filter: { brain_id }, returnMetadata: "indexed" })`.
4. Load chunk texts from D1 by id, build numbered passages, build the system prompt.
5. Stream via the model-family adapter; forward tokens as SSE; on finish save the assistant
   message with citations; auto-title on first exchange (cheap model call with Llama 3.2 3B
   or simple truncation if that fails).

## Security headers (all responses)
`Content-Security-Policy: default-src 'self'; img-src 'self' data: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Permissions-Policy: microphone=(self)`.

## Deployment
- `npm run build` → `dist/web`; `wrangler deploy` uploads assets + Worker.
- Workers Builds: build command `npm run build`, deploy command
  `npx wrangler d1 migrations apply bigbrain-db --remote && npx wrangler deploy`.
- Custom domain in `wrangler.jsonc` (`routes[].custom_domain: true`) creates the DNS record
  and certificate automatically on first deploy.
