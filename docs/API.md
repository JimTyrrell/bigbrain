# BigBrain API contract (v1)

All routes are under `/api`. JSON in, JSON out unless noted. Errors are
`{ "error": { "code": string, "message": string } }` with a 4xx/5xx status.
IDs are 21-char nanoid-style strings generated server-side. Timestamps are ISO-8601 UTC.

Auth: session cookie `bb_session` (HttpOnly, Secure, SameSite=Strict, Path=/).
Every route below except `GET /auth/status`, `POST /auth/setup`, `POST /auth/login`, and
`GET /health` returns `401 {error:{code:"unauthorized"}}` without a valid cookie.

## Health
- `GET /api/health` → `{ ok: true, version: string, time: string }`

## Auth
- `GET /api/auth/status` → `{ pinSet: boolean, authenticated: boolean }`
- `POST /api/auth/setup` `{ pin }` → `204`. Only works when no PIN is set (else `409 pin_already_set`).
  PIN must match `/^\d{6,12}$/` (else `400 invalid_pin`). Also logs the client in (sets cookie).
- `POST /api/auth/login` `{ pin }` → `204` + cookie. Wrong PIN → `401 invalid_credentials`.
  After 5 failures within 15 min from the same IP → `429 locked` with `retryAfterSeconds`.
- `POST /api/auth/change-pin` `{ currentPin, newPin }` → `204`. Wrong current → `401`.
- `POST /api/auth/logout` → `204`, clears cookie.

## Settings
- `GET /api/settings` → `{ defaultModel: string, models: ModelInfo[] }`
- `PUT /api/settings` `{ defaultModel }` → `{ defaultModel }` (must be in the curated list)

```ts
type ModelInfo = {
  id: string;            // "@cf/meta/llama-4-scout-17b-16e-instruct"
  label: string;         // "Llama 4 Scout"
  vendor: string;        // "Meta"
  contextWindow: number; // tokens
  note: string;          // one-line "best for"
  recommended?: boolean; // highlight in picker
};
```

## Brains
```ts
type Brain = { id; name; description: string; documentCount: number; conversationCount: number; createdAt; updatedAt };
```
- `GET /api/brains` → `{ brains: Brain[] }`
- `POST /api/brains` `{ name, description? }` → `201 { brain }`
- `GET /api/brains/:id` → `{ brain }`
- `PATCH /api/brains/:id` `{ name?, description? }` → `{ brain }`
- `DELETE /api/brains/:id` → `204` (cascades: documents, chunks, vectors, conversations)

## Documents
```ts
type Document = {
  id; brainId; title; sourceUrl: string | null; sourceType: "upload" | "text" | "transcript";
  mimeType: string | null; bytes: number; content?: string;   // content only on GET one
  indexStatus: "pending" | "indexed" | "error"; indexError: string | null; chunkCount: number;
  createdAt; updatedAt;
};
```
- `GET /api/brains/:brainId/documents` → `{ documents: Document[] }` (no content)
- `POST /api/brains/:brainId/documents`
  - JSON `{ title, content, sourceUrl?, sourceType? }` (content = markdown/text), or
  - `multipart/form-data` with `file` (+ optional `title`, `sourceUrl`). Text-like files
    (`.txt .md .vtt .srt`) are used directly (VTT/SRT are converted to timestamped
    paragraphs); everything else goes through `env.AI.toMarkdown()`.
  - → `201 { document }` with `indexStatus:"pending"`; indexing runs in `ctx.waitUntil`.
  - Max body 25 MB → `413 too_large`. Unsupported format → `415 unsupported_type`.
- `GET /api/documents/:id` → `{ document }` including `content`
- `PATCH /api/documents/:id` `{ title?, sourceUrl?, content? }` → `{ document }`.
  If `content` changed, the doc is re-indexed (status back to `pending`).
- `POST /api/documents/:id/reindex` → `202 { document }`
- `DELETE /api/documents/:id` → `204` (removes chunks + vectors)

## Conversations and chat
```ts
type Conversation = { id; brainId; title; model: string; messageCount: number; createdAt; updatedAt };
type Citation = { n: number; documentId; documentTitle; chunkId; timestamp: string | null; // "12:34"
                  sourceUrl: string | null; link: string | null; // sourceUrl with &t=754s when timestamp known
                  excerpt: string };
type Message = { id; conversationId; role: "user"|"assistant"; content: string; model: string | null;
                 citations: Citation[]; createdAt };
```
- `GET /api/brains/:brainId/conversations` → `{ conversations: Conversation[] }` newest first
- `POST /api/brains/:brainId/conversations` `{ model? }` → `201 { conversation }` (title "New chat")
- `GET /api/conversations/:id` → `{ conversation, messages: Message[] }`
- `PATCH /api/conversations/:id` `{ title?, model? }` → `{ conversation }`
- `DELETE /api/conversations/:id` → `204`
- `DELETE /api/brains/:brainId/conversations` → `204` (delete all for the brain)
- `POST /api/conversations/:id/messages` `{ content, model? }` → **SSE stream**
  (`Content-Type: text/event-stream`). The user message is saved first. Events:
  - `event: meta` `data: { userMessageId, assistantMessageId, model }`
  - `event: citations` `data: { citations: Citation[] }` (sent before tokens; the retrieved
    chunks, numbered 1..n in the order given to the model)
  - `event: token` `data: { text }` (many)
  - `event: done` `data: { message: Message }` (the saved assistant message; `citations` is
    filtered to the ones actually referenced as `[n]` in the reply, falling back to all)
  - `event: error` `data: { code, message }`
  The first exchange also auto-titles the conversation (≤ 6 words, from the user's message).
  Client may abort; the partial reply is still saved.

### How the model is prompted (shared understanding for UI and validator)
System prompt (summarised): "You answer ONLY from the provided passages from {brain.name}
({brain.description}). Quote them verbatim in quotation marks and cite as [n]. Never invent
a quote. Structure: **What {name} said** (quotes + faithful synthesis), then optionally
**Adjacent insight** labelled as NOT from the source and attributed to the type of
practitioner it comes from. If nothing relevant, say so." Passages are given as
`[n] (Title, mm:ss) text`. The UI renders `[n]` as a superscript link to citation n.

## Voice
- `POST /api/transcribe` `multipart/form-data` `audio` (webm/opus, mp4, wav, mp3; ≤ 10 MB)
  → `{ text: string, language: string | null, durationSeconds: number | null }`
  using `@cf/openai/whisper-large-v3-turbo`.

## Models
- `GET /api/models` → `{ models: ModelInfo[], defaultModel }` (same list as settings)

## Workers AI request/response shapes (backend must normalise)
Three families exist in the catalog; see `docs/model-schemas/*.json` for the exact schemas.
1. **Llama family** (`llama-4-scout`, `llama-3.3-70b`, `mistral-small-3.1`):
   input `{ messages, stream:true, max_tokens, temperature }`; SSE chunks are
   `data: {"response":"tok"}` and end with `data: [DONE]`. Non-stream → `{ response }`.
2. **OpenAI-chat-compatible** (`deepseek-v4-pro`, `kimi-k2.6`, `gemma-4-26b`, `nemotron-3`,
   `qwen3.8`): input `{ messages, stream:true, max_tokens }`; SSE chunks are OpenAI
   `chat.completion.chunk` objects → `choices[0].delta.content`. Non-stream →
   `choices[0].message.content`. Some return reasoning in `delta.reasoning_content`; ignore it.
3. **GPT-OSS** (`gpt-oss-120b`): Responses-API style input
   `{ input: [{role,content}...], instructions, stream:true, reasoning:{effort:"low"} }`;
   SSE events are `response.output_text.delta` with `delta`, ending with `response.completed`.
   Non-stream → `output[]` items; the text is in the `message` item's `content[0].text`.
Implement one `streamChat(env, modelId, {system, messages})` that returns an
`AsyncIterable<string>` of text deltas, with a per-family adapter and a unit test per family
using recorded fixtures.
