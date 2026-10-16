import type { Env } from "../env";
import { runAi } from "./ai";
import { parseSSE, type SSEEvent } from "./sse";

export type Family = "llama" | "openai" | "gpt-oss";

export interface ModelInfo {
  id: string;
  label: string;
  vendor: string;
  contextWindow: number;
  note: string;
  recommended?: boolean;
  /** Typical time to first token: fast ~2 s, medium ~10 s, slow ~40 s (reasoning models). */
  latencyHint: "fast" | "medium" | "slow";
}

interface CatalogEntry extends ModelInfo {
  family: Family;
}

const CATALOG: CatalogEntry[] = [
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", vendor: "Meta", contextWindow: 131072, note: "Fast all-rounder (17B active MoE); the default", recommended: true, latencyHint: "fast", family: "llama" },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", vendor: "Meta", contextWindow: 24000, note: "Dense 70B; solid general answers, shorter context", latencyHint: "fast", family: "llama" },
  { id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", vendor: "OpenAI", contextWindow: 128000, note: "Fast and smart, but tends to paraphrase quotes", latencyHint: "fast", family: "gpt-oss" },
  { id: "@cf/deepseek-ai/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", vendor: "DeepSeek", contextWindow: 1000000, note: "Strongest reasoning; best for careful synthesis", recommended: true, latencyHint: "slow", family: "openai" },
  { id: "@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6", vendor: "Moonshot AI", contextWindow: 262144, note: "1T-parameter MoE; thorough, long answers", latencyHint: "medium", family: "openai" },
  { id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B", vendor: "Google", contextWindow: 256000, note: "Efficient MoE with long context", latencyHint: "fast", family: "openai" },
  { id: "@cf/nvidia/nemotron-3-120b-a12b", label: "Nemotron 3 120B", vendor: "NVIDIA", contextWindow: 256000, note: "Reasoning-tuned MoE with long context", latencyHint: "medium", family: "openai" },
  { id: "@cf/qwen/qwen3.8-27b", label: "Qwen 3.8 27B", vendor: "Qwen", contextWindow: 262144, note: "Multilingual, long context", latencyHint: "fast", family: "openai" },
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1", vendor: "Mistral AI", contextWindow: 128000, note: "Compact and quick; concise answers", latencyHint: "fast", family: "llama" },
];

export const MODELS: ModelInfo[] = CATALOG.map(({ family: _f, ...info }) => info);

export const TITLE_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export const isKnownModel = (id: unknown): id is string => typeof id === "string" && CATALOG.some((m) => m.id === id);

export function familyOf(modelId: string): Family {
  const m = CATALOG.find((x) => x.id === modelId);
  if (!m) throw new Error(`Unknown model ${modelId}`);
  return m.family;
}

export async function getDefaultModel(env: Env): Promise<string> {
  const settings = await env.KV.get<{ defaultModel?: string }>("settings", "json");
  if (isKnownModel(settings?.defaultModel)) return settings.defaultModel;
  return isKnownModel(env.DEFAULT_MODEL) ? env.DEFAULT_MODEL : CATALOG[0].id;
}

// ---------- chat adapters ----------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

interface Adapter {
  input(opts: ChatOptions): Record<string, unknown>;
  /** Text delta from one SSE event; `null` = nothing; `"done"` handled via isDone. */
  delta(ev: SSEEvent, json: any): string | null;
  isDone(ev: SSEEvent, json: any): boolean;
  /** Text from a non-streamed response object. */
  whole(res: any): string;
}

const chatMessages = (o: ChatOptions) => [{ role: "system", content: o.system }, ...o.messages];

export const ADAPTERS: Record<Family, Adapter> = {
  llama: {
    input: (o) => ({ messages: chatMessages(o), stream: true, max_tokens: o.maxTokens ?? 2048, temperature: 0.3 }),
    delta: (_ev, j) =>
      typeof j?.response === "string" ? j.response : (j?.choices?.[0]?.delta?.content ?? null),
    isDone: () => false,
    whole: (r) => (typeof r?.response === "string" ? r.response : (r?.choices?.[0]?.message?.content ?? "")),
  },
  openai: {
    input: (o) => ({ messages: chatMessages(o), stream: true, max_tokens: o.maxTokens ?? 2048 }),
    delta: (_ev, j) => {
      const c = j?.choices?.[0]?.delta?.content;
      return typeof c === "string" ? c : null;
    },
    isDone: () => false,
    whole: (r) => r?.choices?.[0]?.message?.content ?? "",
  },
  // GPT-OSS: the Responses-style request (`{input, instructions, stream}`) currently streams an empty
  // reply on Workers AI, so we send chat-completions `messages` (which streams normally) and parse
  // both Responses events (`response.output_text.delta`) and chat chunks (`choices[0].delta.content`).
  "gpt-oss": {
    input: (o) => ({ messages: chatMessages(o), stream: true, max_tokens: o.maxTokens ?? 2048, reasoning_effort: "low" }),
    delta: (ev, j) => {
      const type = j?.type ?? ev.event;
      if (type === "response.output_text.delta") return typeof j?.delta === "string" ? j.delta : null;
      const c = j?.choices?.[0]?.delta?.content;
      return typeof c === "string" ? c : null;
    },
    isDone: (ev, j) => (j?.type ?? ev.event) === "response.completed",
    whole: (r) => {
      if (r?.choices) return r.choices[0]?.message?.content ?? "";
      const msg = (r?.output ?? []).find((o: any) => o?.type === "message");
      const part = msg?.content?.find?.((c: any) => typeof c?.text === "string") ?? msg?.content?.[0];
      return part?.text ?? "";
    },
  },
};

/** Turn a Workers AI SSE stream into text deltas using the family's adapter. */
export async function* deltasFromStream(family: Family, stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const a = ADAPTERS[family];
  for await (const ev of parseSSE(stream)) {
    if (ev.data.trim() === "[DONE]") return;
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (json?.error || json?.type === "error" || json?.type === "response.failed") {
      throw new Error(String(json?.error?.message ?? json?.error ?? json?.message ?? "Model stream error"));
    }
    const d = a.delta(ev, json);
    if (d) yield d;
    if (a.isDone(ev, json)) return;
  }
}

/** Some models (GPT-OSS) cite with full-width brackets 【1】; normalise to [1]. Char-wise, so split-safe. */
export const normalizeDelta = (d: string) => d.replace(/【/g, "[").replace(/】/g, "]");

/** Stream a chat completion from any curated model as plain text deltas. */
export async function* streamChat(env: Env, modelId: string, opts: ChatOptions): AsyncGenerator<string> {
  const family = familyOf(modelId);
  const input = ADAPTERS[family].input(opts);
  const res = await runAi(env, modelId, input);
  if (res instanceof ReadableStream) {
    let any = false;
    for await (const d of deltasFromStream(family, res as ReadableStream<Uint8Array>)) {
      any = true;
      yield normalizeDelta(d);
    }
    if (any) return;
  } else {
    const text = ADAPTERS[family].whole(res);
    if (text) return yield normalizeDelta(text);
  }
  // The stream produced no text: retry once without streaming.
  const text = ADAPTERS[family].whole(await runAi(env, modelId, { ...input, stream: false }));
  if (text) yield normalizeDelta(text);
}
