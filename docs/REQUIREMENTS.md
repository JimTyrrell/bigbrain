# BigBrain — Refined Requirements

BigBrain is a personal, PIN-protected chat app that answers questions from named **Brains**
(collections of documents such as YouTube transcripts), running entirely on Cloudflare
(Workers, Workers AI, D1, Vectorize, KV) at **https://bigbrain.designaticlabs.com**.

This document is the original request, refined into testable requirements. Each requirement
has an ID so the validator can map checks to it.

## 1. Platform and deployment

- **R1.1** Source lives in a public GitHub repo (`JimTyrrell/bigbrain`). The working copy is
  local (`~/Projects/bigbrain`), not inside Google Drive.
- **R1.2** Deploys to Cloudflare Workers on the `Thedesignatic@gmail.com` account, served at
  `bigbrain.designaticlabs.com` as a Workers custom domain (DNS + TLS managed by Cloudflare).
- **R1.3** Pushes to `main` deploy automatically via Cloudflare **Workers Builds** (the
  GitHub integration). The build runs `npm run build`; the deploy command applies D1
  migrations and then deploys. No local CLI is required to ship a change.
- **R1.4** All AI runs on Workers AI. No third-party AI keys.
- **R1.5** Zero-config bootstrap: the first visit to the site asks you to set a PIN.
  Nothing else needs to be configured by hand.

## 2. Security

- **R2.1** Every API route except auth status/setup/login requires a valid session.
  The SPA shell is public, but it shows nothing but the lock screen until authenticated.
- **R2.2** First run: if no PIN exists, the UI shows **Set your PIN** (6–12 digits, entered
  twice). The PIN is never stored in clear. It is stored as a PBKDF2-SHA256 hash
  (random 16-byte salt, 100 000 iterations) in KV under key `pin_hash`.
- **R2.3** Login: enter PIN → server verifies → sets an `HttpOnly; Secure; SameSite=Strict`
  cookie holding an HMAC-SHA256 signed token (30-day expiry). The signing secret is generated
  on first run and stored in KV (`session_secret`).
- **R2.4** Brute-force protection: 5 failed attempts (tracked in KV by client IP) lock login
  for 15 minutes. Failed attempts return a generic error.
- **R2.5** Change PIN from the Settings panel in the web UI (requires the current PIN).
- **R2.6** Reset a forgotten PIN without the CLI: in the Cloudflare dashboard open
  KV → `BIGBRAIN_KV` → delete key `pin_hash`. The next visit shows **Set your PIN** again.
  Existing sessions are also invalidated (delete `session_secret` too).
- **R2.7** Lock button in the UI logs out (clears cookie).
- **R2.8** Standard hardening: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, no inline
  third-party scripts, request body limit 25 MB, input validation on every route.

## 3. Brains and documents

- **R3.1** Left sidebar lists Brains. You can **add**, **rename**, and **delete** a brain.
  Deleting a brain deletes its documents, vectors, and conversations (with confirmation).
- **R3.2** A brain has a name and an optional one-line description (used in the system
  prompt as "who this brain is", e.g. "Alex Hormozi, business/marketing").
- **R3.3** Selecting a brain shows its **documents**. You can add documents by:
  - uploading a file (PDF, DOCX, XLSX, PPTX, HTML, CSV, images, TXT, MD, VTT/SRT), converted
    to Markdown with Cloudflare's `AI.toMarkdown()`;
  - pasting text/markdown with a title and optional source URL (e.g. a YouTube link).
- **R3.4** Every document is stored as editable Markdown. You can **edit** title, source URL,
  and body in the UI, **re-index** it, or **delete** it.
- **R3.5** Indexing: text is chunked (~1 200 characters, ~200 overlap, paragraph-aware),
  embedded with `@cf/baai/bge-m3` (1024-dim), and upserted to Vectorize with
  `brain_id` / `doc_id` metadata. The document shows its status (pending / indexed / error)
  and chunk count; the UI polls while pending.
- **R3.6** Transcript documents keep `[mm:ss]` timestamp markers per paragraph so quotes
  can link to the moment in the video (`...&t=784s`).
- **R3.7** YouTube links cannot be fetched from a Worker (YouTube blocks it). Transcripts are
  added by paste/upload or by the local `npm run seed` script. Flagged as a future
  enhancement via a transcript service.

## 4. Chat

- **R4.1** Typical chat interface: message list, streaming assistant replies, Markdown
  rendering, stop button, keyboard send (Enter) and newline (Shift+Enter).
- **R4.2** Each conversation belongs to a brain. Conversations are saved automatically and
  listed in the sidebar with an auto-generated title; you can rename, delete one, or delete all.
- **R4.3** **Voice input**: a push-to-talk mic button records audio in the browser
  (MediaRecorder) and sends it to `@cf/openai/whisper-large-v3-turbo` (the largest Whisper on
  Workers AI). The transcript drops into the input box so you can review before sending.
- **R4.4** **Model picker** in the chat header, with human names, size/context hints, and a
  one-line "best for" note. Default is **Llama 4 Scout** (`@cf/meta/llama-4-scout-17b-16e-instruct`).
  Note: Workers AI's Llama 4 is Scout (17B active / 109B total MoE), not a 70B. The 70B
  option is Llama 3.3 70B. Both are offered. The default can be changed in Settings.
  Curated list (all currently live in the catalog):
  | Label | Model id | Notes |
  |---|---|---|
  | Llama 4 Scout (default) | `@cf/meta/llama-4-scout-17b-16e-instruct` | 131k ctx, fast |
  | Llama 3.3 70B | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 24k ctx |
  | GPT-OSS 120B | `@cf/openai/gpt-oss-120b` | strong reasoning, 128k |
  | DeepSeek V4 Pro | `@cf/deepseek-ai/deepseek-v4-pro-0813` | strongest reasoning, 1M ctx |
  | Kimi K2.6 | `@cf/moonshotai/kimi-k2.6` | 1T MoE, 262k |
  | Gemma 4 26B | `@cf/google/gemma-4-26b-a4b-it` | 256k |
  | Nemotron 3 120B | `@cf/nvidia/nemotron-3-120b-a12b` | 256k |
  | Qwen 3.8 27B | `@cf/qwen/qwen3.8-27b` | 262k |
  | Mistral Small 3.1 | `@cf/mistralai/mistral-small-3.1-24b-instruct` | 128k |
- **R4.5** Model choice is per conversation (remembered on the conversation) and shown in
  every assistant message so you always know which model answered.
- **R4.6** Retrieval: the question is embedded, the top 8 chunks from the brain are fetched
  from Vectorize (filtered by `brain_id`), and passed to the model with the last ~10
  messages of the conversation.

## 5. Answer quality and attribution (the key rule)

- **R5.1** The system prompt enforces: **quote the person verbatim** from the retrieved
  passages; never invent quotes; every quote carries a citation `[Title, mm:ss]`.
- **R5.2** Answers are structured as:
  1. **What they said** — direct quotes with citations, then a short synthesis in the
     assistant's own words that stays faithful to the quotes.
  2. **Adjacent insight** (optional, clearly labeled) — the model may add broader
     knowledge, but it must say it is *not* from the source material and attribute it to the
     kind of practitioner it comes from (e.g. "a direct-response copywriter would add…").
- **R5.3** If the brain has nothing relevant, the answer says so plainly instead of guessing.
- **R5.4** The UI shows citations as source cards under the reply (document title, timestamp,
  link to the video moment when a source URL exists).

## 6. Seed content

- **R6.1** Two brains are seeded: **Alex Hormozi** (4 videos) and **Dan Harrison** (5 videos),
  from the URLs in `seeds/manifest.json`.
- **R6.2** Transcripts are fetched locally with `yt-dlp` (auto captions), cleaned (duplicate
  rolling-caption lines removed), paragraphed with `[mm:ss]` markers, and uploaded through
  the normal API by `npm run seed`. Transcript text is **not** committed to the public repo
  (`seeds/raw/` and `seeds/content/` are git-ignored); only the manifest is.

## 7. Validation

- **R7.1** A validator (`npm run validate` → `validate/validate.mjs`) runs against the live
  site and checks: health, auth flow (setup/login/lockout/change PIN), brain CRUD, document
  add/edit/index/delete, chat with streaming and at least one verbatim citation, model
  switching across 3 models, Whisper transcription of a known audio clip, conversation
  save/delete, security headers, and that `bigbrain.designaticlabs.com` serves the app over TLS.
- **R7.2** Unit tests (`npm test`) cover auth hashing/signing, chunking, VTT cleaning, and
  model request/response normalisation.

## Open items for Jim (non-blocking; defaults applied)

1. **Transcripts in the public repo** — default is *not* to commit third-party transcripts.
   Say the word if you want them in the repo.
2. **Default model** — Llama 4 Scout as asked. For strict quoting, GPT-OSS 120B or DeepSeek V4
   Pro tend to follow "quote verbatim" rules better; try them from the picker.
3. **PIN length** — 6–12 digits with lockout. Say if you want 4 digits.
4. **GitHub login** — creating the repo and connecting Workers Builds needs a one-time GitHub
   sign-in (`gh auth login` or signing into github.com in Chrome). Everything else is done.
