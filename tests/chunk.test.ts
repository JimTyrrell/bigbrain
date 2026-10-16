import { describe, expect, it } from "vitest";
import { chunkText, stripMarkers, timestampSeconds } from "../src/worker/lib/chunk";

const sentence = (i: number) => `This is sentence number ${i} about offers and pricing.`;

describe("chunkText", () => {
  it("keeps short text as one chunk", () => {
    const chunks = chunkText("Hello world.\n\nSecond paragraph.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ idx: 0, text: "Hello world.\n\nSecond paragraph.", timestamp: null });
  });

  it("splits long text into ~1200 char chunks with overlap on sentence boundaries", () => {
    const paras = Array.from({ length: 10 }, (_, p) => Array.from({ length: 8 }, (_, s) => sentence(p * 8 + s)).join(" "));
    const chunks = chunkText(paras.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1400);
      expect(c.text).toMatch(/^This is sentence number \d+/); // starts at a sentence boundary
      expect(c.text).toMatch(/pricing\.$/); // ends at a sentence boundary
    }
    // Consecutive chunks overlap: the next chunk starts with a sentence from the previous one.
    for (let i = 1; i < chunks.length; i++) {
      const firstSentence = chunks[i].text.split(/(?<=\.)\s/)[0];
      expect(chunks[i - 1].text).toContain(firstSentence);
    }
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));
  });

  it("hard-splits a single giant sentence", () => {
    const chunks = chunkText("word ".repeat(1000));
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1400);
  });

  it("carries the nearest preceding [mm:ss] marker", () => {
    const paras = Array.from(
      { length: 6 },
      (_, p) => `[${String(p).padStart(2, "0")}:30] ` + Array.from({ length: 6 }, (_, s) => sentence(p * 6 + s)).join(" "),
    );
    const chunks = chunkText(paras.join("\n\n"));
    expect(chunks[0].timestamp).toBe("00:30");
    for (const c of chunks) {
      expect(c.timestamp).toMatch(/^\d\d:30$/);
      // The timestamp is either the chunk's leading marker or one that precedes the chunk's text.
      const lead = /^\[(\d\d:\d\d)\]/.exec(c.text);
      if (lead) expect(c.timestamp).toBe(lead[1]);
    }
    // A chunk starting mid-paragraph inherits that paragraph's marker.
    const long = "[02:10] " + Array.from({ length: 40 }, (_, s) => sentence(s)).join(" ") + "\n\n[04:00] The end.";
    const parts = chunkText(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[1].text.startsWith("[")).toBe(false);
    expect(parts[1].timestamp).toBe("02:10");
    expect(parts[parts.length - 1].text).toContain("[04:00] The end.");
  });

  it("helpers", () => {
    expect(timestampSeconds("12:34")).toBe(754);
    expect(timestampSeconds("1:02:03")).toBe(3723);
    expect(stripMarkers("[00:10] hello [00:50] world")).toBe("hello world");
  });
});
