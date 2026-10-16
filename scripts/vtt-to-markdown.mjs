#!/usr/bin/env node
// Convert a YouTube auto-caption .vtt (yt-dlp) into clean, timestamped Markdown prose.
//
// YouTube "rolling" captions show two lines per cue: the previous line again, plus the
// line being spoken (with <c> word tags and inline <00:00:01.000> timestamps). Between
// them sit ~10 ms "settle" cues that just repeat a line. We keep only the lines a cue
// adds that were not already on screen in the previous cue.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PARA_MIN_SECONDS = 45; // break at the first sentence end after this
const PARA_MAX_SECONDS = 75; // force a break here even mid-sentence

const ENTITIES = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

function toSeconds(ts) {
  const parts = ts.split(':').map(Number); // [h,]m,s.mmm
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTimestamp(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

function cleanLine(line) {
  return line
    .replace(/<[^>]*>/g, '') // <c>, </c>, <00:00:01.000>, <v Speaker> ...
    .replace(/&[a-z]+;|&#\d+;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\[[a-z][a-z ]*\]/g, '') // sound annotations: [music], [laughter], [clears throat]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^>>$/, ''); // a speaker-change marker left with nothing after it
}

/** Parse cues → [{ start, lines: string[] }] with cleaned text. */
function parseCues(vttText) {
  const cues = [];
  for (const block of vttText.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const i = rows.findIndex((r) => r.includes('-->'));
    if (i < 0) continue; // header, NOTE, STYLE
    const start = toSeconds(rows[i].split('-->')[0].trim());
    const lines = rows.slice(i + 1).map(cleanLine).filter(Boolean);
    cues.push({ start, lines });
  }
  return cues;
}

/** De-duplicate rolling captions → [{ start, text }] segments of new speech. */
function dedupe(cues) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, '').trim();
  const segments = [];
  let onScreen = new Set();
  let last = '';
  for (const cue of cues) {
    for (const line of cue.lines) {
      const n = norm(line);
      if (!n || onScreen.has(n) || n === last) continue;
      segments.push({ start: cue.start, text: line });
      last = n;
    }
    onScreen = new Set(cue.lines.map(norm));
  }
  return segments;
}

function paragraphs(segments) {
  const out = [];
  let cur = null;
  for (const seg of segments) {
    if (!cur) cur = { start: seg.start, parts: [] };
    cur.parts.push(seg.text);
    const elapsed = seg.start - cur.start;
    const sentenceEnd = /[.!?]["')\]]?$/.test(seg.text);
    if ((elapsed >= PARA_MIN_SECONDS && sentenceEnd) || elapsed >= PARA_MAX_SECONDS) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.map((p) => ({ start: p.start, text: p.parts.join(' ').replace(/(?:>>\s*){2,}/g, '>> ').replace(/\s+/g, ' ').trim() }));
}

export function vttToMarkdown(vttText, { title = 'Transcript', url = '' } = {}) {
  const paras = paragraphs(dedupe(parseCues(vttText)));
  const body = paras.map((p) => `[${formatTimestamp(p.start)}] ${p.text}`).join('\n\n');
  const header = [`# ${title}`, url ? `Source: ${url}` : null].filter(Boolean).join('\n');
  return `${header}\n\n${body}\n`;
}

// CLI: node scripts/vtt-to-markdown.mjs in.vtt [--title T] [--url U] > out.md
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const title = opt('--title');
  const url = opt('--url');
  const file = args[0];
  if (!file) {
    console.error('Usage: node scripts/vtt-to-markdown.mjs in.vtt [--title "Title"] [--url URL] > out.md');
    process.exit(1);
  }
  const name = file.split('/').pop().replace(/\.[a-z-]+\.vtt$|\.vtt$/i, '');
  process.stdout.write(vttToMarkdown(readFileSync(file, 'utf8'), { title: title ?? name, url: url ?? '' }));
}
