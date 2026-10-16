/**
 * Paragraph/sentence-aware chunking with overlap. Each chunk carries the nearest preceding
 * `[mm:ss]` transcript marker as its timestamp.
 */

export interface Chunk {
  idx: number;
  text: string;
  timestamp: string | null; // "mm:ss"
}

interface Unit {
  text: string;
  paraStart: boolean;
  ts: string | null;
}

export const MARKER_RE = /\[((?:\d+:)?\d{1,3}:\d{2})\]/g;
const LEADING_MARKER_RE = /^\[((?:\d+:)?\d{1,3}:\d{2})\]/;

function splitSentences(p: string): string[] {
  return p.split(/(?<=[.!?]["')\]]?)\s+(?=\S)/).filter(Boolean);
}

/** Hard-split an over-long piece at whitespace. */
function splitLong(s: string, size: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(" ", size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function toUnits(text: string, size: number): Unit[] {
  const units: Unit[] = [];
  let carry: string | null = null;
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    const pieces = splitSentences(p).flatMap((s) => (s.length > size ? splitLong(s, size) : [s]));
    pieces.forEach((piece, i) => {
      const lead = LEADING_MARKER_RE.exec(piece);
      units.push({ text: piece, paraStart: i === 0, ts: lead ? lead[1] : carry });
      const markers = [...piece.matchAll(MARKER_RE)];
      if (markers.length) carry = markers[markers.length - 1][1];
    });
  }
  return units;
}

const join = (units: Unit[]) =>
  units.map((u, i) => (i === 0 ? "" : u.paraStart ? "\n\n" : " ") + u.text).join("");

export function chunkText(text: string, size = 1200, overlap = 200): Chunk[] {
  const units = toUnits(text, size);
  const groups: Unit[][] = [];
  let cur: Unit[] = [];
  let len = 0;
  let fresh = 0; // units in `cur` that are not overlap carried from the previous chunk
  for (const u of units) {
    const add = (cur.length ? 2 : 0) + u.text.length;
    if (cur.length && fresh > 0 && len + add > size) {
      groups.push(cur);
      // Carry trailing units (≤ overlap chars) into the next chunk.
      const tail: Unit[] = [];
      let tailLen = 0;
      for (let i = cur.length - 1; i > 0; i--) {
        if (tailLen + cur[i].text.length > overlap) break;
        tail.unshift(cur[i]);
        tailLen += cur[i].text.length + 1;
      }
      while (tail.length && tailLen + u.text.length > size) tailLen -= tail.shift()!.text.length + 1;
      cur = tail;
      len = tailLen;
      fresh = 0;
    }
    cur.push(u);
    len += (cur.length > 1 ? 2 : 0) + u.text.length;
    fresh++;
  }
  if (cur.length && fresh > 0) groups.push(cur);

  return groups.map((g, idx) => {
    const text = join(g);
    const first = [...text.matchAll(MARKER_RE)][0];
    return { idx, text, timestamp: g[0].ts ?? (first ? first[1] : null) };
  });
}

/** "mm:ss" or "h:mm:ss" → seconds. */
export function timestampSeconds(ts: string): number {
  return ts.split(":").map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

/** Remove inline `[mm:ss]` markers (used for passages shown to the model and excerpts). */
export const stripMarkers = (s: string) => s.replace(MARKER_RE, "").replace(/[ \t]{2,}/g, " ").trim();
