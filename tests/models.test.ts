import { describe, expect, it } from "vitest";
import { ADAPTERS, MODELS, deltasFromStream, familyOf, normalizeDelta, type Family } from "../src/worker/lib/models";
import { parseSSE, streamFromString } from "../src/worker/lib/sse";

async function collect(family: Family, sse: string, pieceSize?: number): Promise<string> {
  let out = "";
  for await (const d of deltasFromStream(family, streamFromString(sse, pieceSize))) out += d;
  return out;
}

// Recorded-style fixtures for each Workers AI response family.
const LLAMA_SSE = [
  'data: {"response":"\\"Make"}',
  'data: {"response":" offers"}',
  'data: {"response":" so good\\" [1]","p":"abc"}',
  'data: {"response":"","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
  "data: [DONE]",
  "",
].join("\n\n");

const OPENAI_SSE = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}',
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":", world [2]"},"finish_reason":"stop"}]}',
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"prompt_tokens":3}}',
  "data: [DONE]",
  "",
].join("\r\n\r\n");

const GPT_OSS_SSE = [
  'event: response.created\ndata: {"type":"response.created","sequence_number":0,"response":{"id":"r1","status":"in_progress"}}',
  'event: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"plan"}',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","sequence_number":2,"item_id":"m1","output_index":1,"content_index":0,"delta":"Price is"}',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","sequence_number":3,"item_id":"m1","output_index":1,"content_index":0,"delta":" what you pay [3]"}',
  'event: response.output_text.done\ndata: {"type":"response.output_text.done","sequence_number":4,"text":"Price is what you pay [3]"}',
  'event: response.completed\ndata: {"type":"response.completed","sequence_number":5,"response":{"id":"r1","status":"completed"}}',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"IGNORED"}',
  "",
].join("\n\n");

// Recorded from @cf/openai/gpt-oss-120b with `messages` + stream (reasoning deltas are ignored).
const GPT_OSS_CHAT_SSE = [
  'data: {"id":"c","object":"chat.completion.chunk","model":"@cf/openai/gpt-oss-120b","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"p":"9ajf"}',
  'data: {"id":"c","object":"chat.completion.chunk","model":"@cf/openai/gpt-oss-120b","choices":[{"index":0,"delta":{"reasoning":"Need","reasoning_content":"Need"},"finish_reason":null}]}',
  'data: {"id":"c","object":"chat.completion.chunk","model":"@cf/openai/gpt-oss-120b","choices":[{"index":0,"delta":{"content":"Hi there"},"finish_reason":null}]}',
  'data: {"id":"c","object":"chat.completion.chunk","model":"@cf/openai/gpt-oss-120b","choices":[{"index":0,"delta":{"content":", friend!"},"finish_reason":"stop"}]}',
  "data: [DONE]",
  "",
].join("\n\n");

describe("SSE parsing", () => {
  it("handles events split across arbitrary chunk boundaries", async () => {
    const events = [];
    for await (const e of parseSSE(streamFromString("event: a\ndata: 1\ndata: 2\n\n: comment\n\ndata: x", 3))) events.push(e);
    expect(events).toEqual([
      { event: "a", data: "1\n2" },
      { event: null, data: "x" },
    ]);
  });
});

describe("model adapters", () => {
  it("llama family: data.response deltas", async () => {
    expect(await collect("llama", LLAMA_SSE)).toBe('"Make offers so good" [1]');
    expect(await collect("llama", LLAMA_SSE, 1)).toBe('"Make offers so good" [1]');
    expect(ADAPTERS.llama.whole({ response: "hi" })).toBe("hi");
  });

  it("openai-chat family: choices[0].delta.content, ignoring reasoning", async () => {
    expect(await collect("openai", OPENAI_SSE)).toBe("Hello, world [2]");
    expect(ADAPTERS.openai.whole({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });

  it("gpt-oss family: response.output_text.delta until response.completed", async () => {
    expect(await collect("gpt-oss", GPT_OSS_SSE)).toBe("Price is what you pay [3]");
    // GPT-OSS streamed via chat-completions messages (what Workers AI actually streams today).
    expect(await collect("gpt-oss", GPT_OSS_CHAT_SSE)).toBe("Hi there, friend!");
    expect(
      ADAPTERS["gpt-oss"].whole({
        output: [
          { type: "reasoning", content: [{ type: "reasoning_text", text: "x" }] },
          { type: "message", content: [{ type: "output_text", text: "hi" }] },
        ],
      }),
    ).toBe("hi");
  });

  it("builds family-specific inputs", () => {
    const opts = { system: "SYS", messages: [{ role: "user" as const, content: "Q" }], maxTokens: 100 };
    expect(ADAPTERS.llama.input(opts)).toMatchObject({
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "Q" }],
      stream: true,
      max_tokens: 100,
    });
    expect(ADAPTERS.openai.input(opts)).toMatchObject({ stream: true, max_tokens: 100 });
    expect(ADAPTERS["gpt-oss"].input(opts)).toEqual({
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "Q" }],
      stream: true,
      max_tokens: 100,
      reasoning_effort: "low",
    });
  });

  it("normalises full-width citation brackets", () => {
    expect(normalizeDelta("pay【1】 and 【")).toBe("pay[1] and [");
  });

  it("surfaces stream errors", async () => {
    await expect(collect("openai", 'data: {"error":{"message":"boom"}}\n\n')).rejects.toThrow("boom");
  });

  it("catalog matches the curated list", () => {
    expect(MODELS).toHaveLength(9);
    expect(MODELS.filter((m) => m.recommended).map((m) => m.label)).toEqual(["GPT-OSS 120B", "DeepSeek V4 Pro"]);
    expect(familyOf("@cf/openai/gpt-oss-120b")).toBe("gpt-oss");
    expect(familyOf("@cf/mistralai/mistral-small-3.1-24b-instruct")).toBe("llama");
    expect(familyOf("@cf/qwen/qwen3.8-27b")).toBe("openai");
    expect(MODELS.every((m) => !("family" in m))).toBe(true);
  });
});
