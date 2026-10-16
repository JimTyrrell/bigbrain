// Shared helpers for the seed scripts.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = join(ROOT, 'seeds', 'content');

export function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'seeds', 'manifest.json'), 'utf8'));
}

/** "Alex Hormozi" -> "alex-hormozi" */
export function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** yt-dlp writes <id>.en.vtt (or <id>.en-orig.vtt etc.); find whichever exists. */
export function findVtt(rawDir, id) {
  const dir = join(ROOT, rawDir);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(`${id}.`) && f.endsWith('.vtt'));
  files.sort((a, b) => (a === `${id}.en.vtt` ? -1 : b === `${id}.en.vtt` ? 1 : a.localeCompare(b)));
  return files.length ? join(dir, files[0]) : null;
}

export function contentPath(brain, video) {
  return join(CONTENT_DIR, slugify(brain.name), `${video.id}.md`);
}

export function printTable(rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(width[i])).join('  ');
  console.log(line(cols));
  console.log(line(width.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}
