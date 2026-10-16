/**
 * WebVTT / SRT → cleaned, timestamped paragraphs.
 * Handles YouTube auto-captions: inline word timing tags, and "rolling" cues where every
 * cue repeats the previous line before adding a new one.
 */

export interface Cue {
  start: number; // seconds
  lines: string[];
}

const TIMING_RE = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->/;
const SOUND_TAG_RE = /\[(?:music|applause|laughter|laughs|inaudible|silence|noise)\]/gi;

export function parseTime(t: string): number {
  const parts = t.replace(",", ".").split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** "[mm:ss]" body (minutes are not wrapped at 60, so long videos give e.g. "75:12"). */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function cleanLine(line: string): string {
  return decodeEntities(
    line
      .replace(/<[^>]*>/g, "") // <c>, </c>, <00:00:01.000>, <v Name>, <i> …
      .replace(/\{\\[^}]*\}/g, "") // SRT positioning like {\an8}
      .replace(SOUND_TAG_RE, " "), // [Music], [Applause] …
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse VTT or SRT text into cues with cleaned, non-empty lines. */
export function parseCues(text: string): Cue[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const cues: Cue[] = [];
  let current: Cue | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = TIMING_RE.exec(lines[i]);
    if (m) {
      // A non-blank line directly before a timing line is a cue identifier, not text.
      if (current && i > 0 && lines[i - 1].trim() !== "" && current.lines.length) {
        const prevClean = cleanLine(lines[i - 1]);
        if (current.lines[current.lines.length - 1] === prevClean) current.lines.pop();
      }
      current = { start: parseTime(m[1]), lines: [] };
      cues.push(current);
      continue;
    }
    if (!current) continue; // header (WEBVTT, Kind:, Language:, …)
    const clean = cleanLine(lines[i]);
    if (clean) current.lines.push(clean);
  }
  return cues.filter((c) => c.lines.length > 0);
}

/** Flatten cues into unique spoken lines, dropping rolling-caption repeats. */
export function dedupeLines(cues: Cue[]): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const recent: string[] = [];
  for (const cue of cues) {
    for (const line of cue.lines) {
      if (recent.includes(line)) continue;
      out.push({ start: cue.start, text: line });
      recent.push(line);
      if (recent.length > 3) recent.shift();
    }
  }
  return out;
}

/** Merge lines into ~40–80 s paragraphs, each prefixed with `[mm:ss]`. */
export function toParagraphs(lines: { start: number; text: string }[], minSec = 40, maxSec = 80): string[] {
  const paras: string[] = [];
  let startAt = 0;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) paras.push(`[${formatTimestamp(startAt)}] ${buf.join(" ")}`);
    buf = [];
  };
  for (const line of lines) {
    if (buf.length) {
      const elapsed = line.start - startAt;
      const sentenceEnd = /[.!?]["')\]]?$/.test(buf[buf.length - 1]);
      if (elapsed >= maxSec || (elapsed >= minSec && sentenceEnd)) flush();
    }
    if (!buf.length) startAt = line.start;
    buf.push(line.text);
  }
  flush();
  return paras;
}

/** Full pipeline: VTT/SRT text → Markdown body of timestamped paragraphs. */
export function captionsToMarkdown(text: string): string {
  return toParagraphs(dedupeLines(parseCues(text))).join("\n\n");
}

export const looksLikeCaptions = (text: string) =>
  /^﻿?WEBVTT/.test(text.trimStart()) || /^\s*\d+\s*\r?\n\s*\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text);
