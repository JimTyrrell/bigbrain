import { describe, expect, it } from "vitest";
import { captionsToMarkdown, cleanLine, dedupeLines, formatTimestamp, parseCues, toParagraphs } from "../src/worker/lib/vtt";

// Shaped like YouTube auto-subs (yt-dlp --write-auto-subs): word-timing tags, and rolling
// cues where each cue repeats the previous line, plus 10 ms "snapshot" cues.
const YT = `WEBVTT
Kind: captions
Language: en

00:00:00.160 --> 00:00:02.230 align:start position:0%
 
so<00:00:00.480><c> today</c><00:00:00.640><c> we're</c><00:00:00.880><c> talking</c>

00:00:02.230 --> 00:00:02.240 align:start position:0%
so today we're talking
 

00:00:02.240 --> 00:00:04.990 align:start position:0%
so today we're talking
about<00:00:02.560><c> grand</c><00:00:02.800><c> slam</c><00:00:03.100><c> offers</c>

00:00:04.990 --> 00:00:05.000 align:start position:0%
about grand slam offers
 

00:00:05.000 --> 00:00:07.000 align:start position:0%
about grand slam offers
[Music]

00:00:45.000 --> 00:00:47.000 align:start position:0%
[Music]
the<00:00:45.300><c> price</c><00:00:45.600><c> is</c><00:00:45.900><c> what</c> you pay &amp; more

00:01:30.000 --> 00:01:32.000 align:start position:0%
the price is what you pay &amp; more
value<00:01:30.500><c> is</c> what you get
`;

describe("VTT cleaning", () => {
  it("strips tags and entities", () => {
    expect(cleanLine("the<00:00:45.300><c> price</c> &amp; <i>more</i>")).toBe("the price & more");
    expect(cleanLine("per [music] year")).toBe("per year");
  });

  it("drops rolling duplicate lines and sound tags", () => {
    const lines = dedupeLines(parseCues(YT)).map((l) => l.text);
    expect(lines).toEqual([
      "so today we're talking",
      "about grand slam offers",
      "the price is what you pay & more",
      "value is what you get",
    ]);
  });

  it("produces timestamped paragraphs of ~40-80 s", () => {
    const md = captionsToMarkdown(YT);
    const paras = md.split("\n\n");
    expect(paras).toEqual([
      "[00:00] so today we're talking about grand slam offers the price is what you pay & more",
      "[01:30] value is what you get",
    ]);
    expect(md).not.toMatch(/<|&amp;|-->/);
  });

  it("closes paragraphs at sentence ends after 40 s", () => {
    const paras = toParagraphs([
      { start: 0, text: "First idea." },
      { start: 41, text: "Second idea." },
      { start: 50, text: "More." },
    ]);
    expect(paras).toEqual(["[00:00] First idea.", "[00:41] Second idea. More."]);
  });

  it("parses SRT with cue numbers", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello <b>there</b>\n\n2\n00:01:25,500 --> 00:01:27,000\nGeneral Kenobi\n";
    expect(captionsToMarkdown(srt)).toBe("[00:01] Hello there\n\n[01:25] General Kenobi");
  });

  it("formats long timestamps without wrapping minutes", () => {
    expect(formatTimestamp(4512)).toBe("75:12");
    expect(formatTimestamp(5)).toBe("00:05");
  });
});
