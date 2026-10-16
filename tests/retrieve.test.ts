import { describe, expect, it } from "vitest";
import type { Citation } from "../src/worker/lib/db";
import { buildSystemPrompt } from "../src/worker/lib/prompt";
import { filterCited, linkFor } from "../src/worker/lib/retrieve";
import { cleanTitle, truncateTitle } from "../src/worker/routes/chat";

const cite = (n: number): Citation => ({
  n,
  documentId: "d",
  documentTitle: `Doc ${n}`,
  chunkId: `d:${n}`,
  timestamp: "12:34",
  sourceUrl: "https://www.youtube.com/watch?v=abc",
  link: null,
  excerpt: `text ${n}`,
});

describe("citations and prompt", () => {
  it("links to the moment in the video", () => {
    expect(linkFor("https://www.youtube.com/watch?v=abc", "12:34")).toBe("https://www.youtube.com/watch?v=abc&t=754s");
    expect(linkFor("https://youtu.be/abc", "00:05")).toBe("https://youtu.be/abc?t=5s");
    expect(linkFor(null, "00:05")).toBeNull();
    expect(linkFor("https://x.test", null)).toBeNull();
  });

  it("filters to referenced citations, falling back to all", () => {
    const all = [cite(1), cite(2), cite(3)];
    expect(filterCited('"a" [2] and [1, 3]', all).map((c) => c.n)).toEqual([1, 2, 3]);
    expect(filterCited('"a" [2]', all).map((c) => c.n)).toEqual([2]);
    expect(filterCited("no refs", all)).toHaveLength(3);
  });

  it("builds a system prompt with numbered passages", () => {
    const p = buildSystemPrompt({ name: "Alex Hormozi", description: "business/marketing" }, [cite(1)]);
    expect(p).toContain("Alex Hormozi (business/marketing)");
    expect(p).toContain("**What Alex Hormozi said**");
    expect(p).toContain("**Adjacent insight**");
    expect(p).toContain("[1] (Doc 1, 12:34) text 1");
    expect(buildSystemPrompt({ name: "X", description: "" }, [])).toContain("none were found");
  });

  it("cleans and truncates titles", () => {
    expect(cleanTitle('"Pricing Your Grand Slam Offer."')).toBe("Pricing Your Grand Slam Offer");
    expect(cleanTitle("Title: one two three four five six seven")).toBe("one two three four five six");
    expect(cleanTitle("'Tina's Biggest Constraint'")).toBe("Tina's Biggest Constraint");
    expect(cleanTitle("Pricing Coaching Offers: A Strategic Guide")).toBe("Pricing Coaching Offers");
    expect(cleanTitle('Here are some options:\n\n"Pricing Coaching Offers"')).toBe("Pricing Coaching Offers");
    expect(truncateTitle("how do I   price a high ticket coaching offer today")).toBe("how do I price a high");
  });
});
