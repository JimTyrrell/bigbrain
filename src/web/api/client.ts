import type {
  AuthStatus,
  Brain,
  BrainDocument,
  ChatHandlers,
  Conversation,
  Message,
  ModelsResponse,
  Settings,
  SourceType,
  Transcription,
} from "./types";

/** Error thrown for any non-2xx response. */
export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds: number | null;
  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type Listener<T> = (v: T) => void;
let onUnauthorized: Listener<void> = () => {};
let onError: Listener<ApiError> = () => {};

/** Called when any authenticated route returns 401 unauthorized: return to the lock screen. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}
/** Central error sink (the app wires this to toasts). Not called for `quiet` requests. */
export function setErrorHandler(fn: (e: ApiError) => void) {
  onError = fn;
}

type ReqOpts = {
  /** Don't route the error to the global toast handler (caller handles it). */
  quiet?: boolean;
  /** A 401 from this route is a business error (e.g. wrong PIN), not a lost session. */
  authRoute?: boolean;
  signal?: AbortSignal;
};

async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || "Request failed";
  let retry: number | null = null;
  try {
    const text = await res.text();
    if (text) {
      const body = JSON.parse(text) as Record<string, unknown>;
      const err = (body.error ?? {}) as Record<string, unknown>;
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string" && err.message) message = err.message;
      const r = err.retryAfterSeconds ?? body.retryAfterSeconds;
      if (typeof r === "number") retry = r;
    }
  } catch {
    /* non-JSON body */
  }
  if (retry == null) {
    const h = res.headers.get("Retry-After");
    if (h && /^\d+$/.test(h)) retry = Number(h);
  }
  if (res.status === 413 && code.startsWith("http_")) code = "too_large";
  return new ApiError(res.status, code, friendlyMessage(code, message), retry);
}

function friendlyMessage(code: string, fallback: string): string {
  switch (code) {
    case "too_large":
      return "That file is too large (max 25 MB).";
    case "unsupported_type":
      return "That file type isn't supported.";
    case "invalid_credentials":
      return "Incorrect PIN.";
    case "locked":
      return "Too many attempts. Try again later.";
    default:
      return fallback;
  }
}

async function handleFailure(res: Response, opts: ReqOpts): Promise<never> {
  const err = await parseError(res);
  if (res.status === 401 && !opts.authRoute) {
    onUnauthorized();
    throw err;
  }
  if (!opts.quiet) onError(err);
  throw err;
}

async function request<T>(method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", signal: opts.signal, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  (init.headers as Record<string, string>)["Accept"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const err = new ApiError(0, "network", "Network error. Check your connection.");
    if (!opts.quiet) onError(err);
    throw err;
  }
  if (!res.ok) return handleFailure(res, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const err = new ApiError(res.status, "bad_response", "Unexpected response from server.");
    if (!opts.quiet) onError(err);
    throw err;
  }
}

const enc = encodeURIComponent;

export const api = {
  // Health
  health: () => request<{ ok: boolean; version: string; time: string }>("GET", "/health"),

  // Auth
  authStatus: () => request<AuthStatus>("GET", "/auth/status", undefined, { quiet: true, authRoute: true }),
  setupPin: (pin: string) => request<void>("POST", "/auth/setup", { pin }, { quiet: true, authRoute: true }),
  login: (pin: string) => request<void>("POST", "/auth/login", { pin }, { quiet: true, authRoute: true }),
  changePin: (currentPin: string, newPin: string) =>
    request<void>("POST", "/auth/change-pin", { currentPin, newPin }, { quiet: true, authRoute: true }),
  logout: () => request<void>("POST", "/auth/logout", undefined, { quiet: true, authRoute: true }),

  // Settings & models
  getSettings: () => request<Settings>("GET", "/settings"),
  putSettings: (defaultModel: string) => request<{ defaultModel: string }>("PUT", "/settings", { defaultModel }),
  getModels: () => request<ModelsResponse>("GET", "/models"),

  // Brains
  listBrains: () => request<{ brains: Brain[] }>("GET", "/brains").then((r) => r.brains ?? []),
  createBrain: (name: string, description?: string) =>
    request<{ brain: Brain }>("POST", "/brains", { name, description }).then((r) => r.brain),
  getBrain: (id: string) => request<{ brain: Brain }>("GET", `/brains/${enc(id)}`).then((r) => r.brain),
  updateBrain: (id: string, patch: { name?: string; description?: string }) =>
    request<{ brain: Brain }>("PATCH", `/brains/${enc(id)}`, patch).then((r) => r.brain),
  deleteBrain: (id: string) => request<void>("DELETE", `/brains/${enc(id)}`),

  // Documents
  listDocuments: (brainId: string, opts?: ReqOpts) =>
    request<{ documents: BrainDocument[] }>("GET", `/brains/${enc(brainId)}/documents`, undefined, opts).then(
      (r) => r.documents ?? [],
    ),
  createTextDocument: (
    brainId: string,
    doc: { title: string; content: string; sourceUrl?: string; sourceType?: SourceType },
  ) =>
    request<{ document: BrainDocument }>("POST", `/brains/${enc(brainId)}/documents`, doc).then((r) => r.document),
  uploadDocument: (brainId: string, file: File, extra: { title?: string; sourceUrl?: string } = {}) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (extra.title) fd.append("title", extra.title);
    if (extra.sourceUrl) fd.append("sourceUrl", extra.sourceUrl);
    return request<{ document: BrainDocument }>("POST", `/brains/${enc(brainId)}/documents`, fd).then(
      (r) => r.document,
    );
  },
  getDocument: (id: string) =>
    request<{ document: BrainDocument }>("GET", `/documents/${enc(id)}`).then((r) => r.document),
  updateDocument: (id: string, patch: { title?: string; sourceUrl?: string | null; content?: string }) =>
    request<{ document: BrainDocument }>("PATCH", `/documents/${enc(id)}`, patch).then((r) => r.document),
  reindexDocument: (id: string) =>
    request<{ document: BrainDocument }>("POST", `/documents/${enc(id)}/reindex`).then((r) => r.document),
  deleteDocument: (id: string) => request<void>("DELETE", `/documents/${enc(id)}`),

  // Conversations
  listConversations: (brainId: string) =>
    request<{ conversations: Conversation[] }>("GET", `/brains/${enc(brainId)}/conversations`).then(
      (r) => r.conversations ?? [],
    ),
  createConversation: (brainId: string, model?: string) =>
    request<{ conversation: Conversation }>("POST", `/brains/${enc(brainId)}/conversations`, model ? { model } : {}).then(
      (r) => r.conversation,
    ),
  getConversation: (id: string, opts?: ReqOpts) =>
    request<{ conversation: Conversation; messages: Message[] }>("GET", `/conversations/${enc(id)}`, undefined, opts),
  updateConversation: (id: string, patch: { title?: string; model?: string }) =>
    request<{ conversation: Conversation }>("PATCH", `/conversations/${enc(id)}`, patch).then((r) => r.conversation),
  deleteConversation: (id: string) => request<void>("DELETE", `/conversations/${enc(id)}`),
  deleteAllConversations: (brainId: string) => request<void>("DELETE", `/brains/${enc(brainId)}/conversations`),

  // Voice
  transcribe: (audio: Blob, filename: string) => {
    const fd = new FormData();
    fd.append("audio", audio, filename);
    return request<Transcription>("POST", "/transcribe", fd, { quiet: true });
  },

  sendMessage,
};

/**
 * POST /api/conversations/:id/messages and consume the SSE stream.
 * Resolves when the stream ends (done, error, or abort). Abort via `signal`.
 */
async function sendMessage(
  conversationId: string,
  body: { content: string; model?: string },
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${enc(conversationId)}/messages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    handlers.onError?.({ code: "network", message: "Network error. Check your connection." });
    return;
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401) onUnauthorized();
    handlers.onError?.({ code: err.code, message: err.message });
    return;
  }
  if (!res.body) {
    handlers.onError?.({ code: "no_stream", message: "The server did not return a stream." });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line || line.startsWith(":")) continue;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    switch (event) {
      case "meta":
        handlers.onMeta?.(payload as never);
        break;
      case "citations":
        handlers.onCitations?.(Array.isArray(payload.citations) ? (payload.citations as never) : []);
        break;
      case "token":
        if (typeof payload.text === "string") handlers.onToken?.(payload.text);
        break;
      case "done":
        finished = true;
        handlers.onDone?.(payload.message as Message);
        break;
      case "error":
        finished = true;
        handlers.onError?.({
          code: String(payload.code ?? "error"),
          message: String(payload.message ?? "Something went wrong."),
        });
        break;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatch(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    if (!finished) handlers.onError?.({ code: "stream", message: "The connection was interrupted." });
    return;
  }
  if (!finished && !signal?.aborted) {
    handlers.onError?.({ code: "stream_ended", message: "The reply ended unexpectedly." });
  }
}
