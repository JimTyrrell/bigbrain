# BigBrain

Personal, PIN-protected chat over named **Brains** of documents (YouTube transcripts, PDFs,
notes), running entirely on Cloudflare: Workers, Workers AI (Llama 4, GPT-OSS, DeepSeek,
Whisper), D1, Vectorize and KV. No third-party AI keys.

Live: **https://bigbrain.designaticlabs.com**

## What it does

- **Brains** in the left sidebar: add, rename, delete. Each brain has a name, a one-line
  description and a set of documents.
- **Documents**: upload files (PDF, DOCX, XLSX, PPTX, HTML, CSV, images, TXT, MD, VTT/SRT) or
  paste text. Everything is stored as editable Markdown, chunked, embedded with `bge-m3` and
  indexed in Vectorize. Edit, re-index or delete any document in the UI.
- **Chat**: streaming answers with a model picker (Llama 4 Scout by default; GPT-OSS 120B,
  DeepSeek V4 Pro, Kimi K2.6, Gemma 4, Nemotron 3, Qwen 3.8, Llama 3.3 70B, Mistral Small 3.1).
  Answers **quote the person verbatim** with `[n]` citations that link to the moment in the
  video. Anything beyond the sources is labelled "Adjacent insight" and attributed.
- **Voice**: hold the mic button to talk; `whisper-large-v3-turbo` transcribes into the composer.
- **Conversations** are saved per brain; rename, delete one, or delete all.
- **Security**: a PIN you set on first visit (6–12 digits, PBKDF2-hashed in KV), signed
  HttpOnly session cookie, 5-attempt lockout, change PIN in Settings, strict CSP.

## Docs

- [Requirements](docs/REQUIREMENTS.md) (with IDs the validator maps to)
- [Architecture](docs/ARCHITECTURE.md)
- [API contract](docs/API.md)
- [Seeding transcripts](seeds/README.md)

## Deploy your own copy (one click)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JimTyrrell/bigbrain)

`https://deploy.workers.cloudflare.com/?url=https://github.com/JimTyrrell/bigbrain`

Cloudflare forks the repo into your GitHub, provisions the D1 database, KV namespace,
Vectorize index and Workers AI binding declared in `wrangler.jsonc`, runs `npm run build`
and `npm run deploy` (which applies the D1 migrations), and sets up automatic deploys on
push. After the first deploy, open the `*.workers.dev` URL, set your PIN, and optionally add
a custom domain under **Settings → Domains & Routes**. The Vectorize index needs one manual
step on a fresh account: in the dashboard (or `npx wrangler vectorize create-metadata-index
bigbrain-vectors --property-name=brain_id --type=string`) add a string metadata index on
`brain_id`, otherwise retrieval cannot filter by brain.

## Running it yourself

```bash
npm install
npm run build        # web app → dist/web
npm run dev          # Worker + built assets on http://localhost:8787
npm run dev:web      # Vite dev server with /api proxied to :8787
npm test             # unit tests (auth, chunking, VTT cleaning, model adapters, routes)
npm run typecheck
```

Deploying to your own account: create a D1 database, a Vectorize index
(`--dimensions=1024 --metric=cosine`, plus a `brain_id` string metadata index) and a KV
namespace, put their ids in `wrangler.jsonc`, then `npm run deploy`. Production deploys for
this repo happen automatically from `main` via Cloudflare Workers Builds (build
`npm run build`, deploy `npx wrangler d1 migrations apply bigbrain-db --remote && npx wrangler deploy`).

## Seeding the two starter brains

```bash
node scripts/fetch-transcripts.mjs                    # needs yt-dlp; writes seeds/raw/
node scripts/build-seeds.mjs                          # VTT → timestamped markdown in seeds/content/
BIGBRAIN_URL=https://bigbrain.designaticlabs.com BIGBRAIN_PIN=123456 npm run seed
```

Transcript text is git-ignored on purpose; only `seeds/manifest.json` (the video list) is committed.

## Validating a deployment

```bash
BIGBRAIN_URL=https://bigbrain.designaticlabs.com BIGBRAIN_PIN=123456 npm run validate
```

Runs the end-to-end checks in `validate/validate.mjs` (auth, CRUD, indexing, chat with
verbatim-quote verification, model switching, Whisper, lockout) and exits non-zero on failure.

## Forgot your PIN?

No CLI needed. In the Cloudflare dashboard: **Workers & Pages → KV → `BIGBRAIN_KV`**, delete
the keys `pin_hash` and `session_secret`, then reload the site. It will ask you to set a new PIN.

Step-by-step guide with a deep link and the CLI alternative: [docs/RESET-PIN.md](docs/RESET-PIN.md).
The same instructions are built into the app (lock screen → **Forgot your PIN?**, and Settings).
