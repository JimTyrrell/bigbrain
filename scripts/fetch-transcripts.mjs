#!/usr/bin/env node
// Download YouTube captions (.vtt) for every manifest video that doesn't have one yet.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadManifest, findVtt } from './lib-seeds.mjs';

const probe = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log('yt-dlp not found on PATH; skipping caption download.');
  console.log('Install it (e.g. `brew install yt-dlp` or `pipx install yt-dlp`) and re-run.');
  process.exit(0);
}

let fetched = 0, failed = 0, present = 0;
for (const brain of loadManifest().brains) {
  const rawDir = join(ROOT, brain.rawDir);
  mkdirSync(rawDir, { recursive: true });
  for (const video of brain.videos) {
    if (findVtt(brain.rawDir, video.id)) { present++; continue; }
    console.log(`fetching ${brain.name} / ${video.id}  ${video.title}`);
    const r = spawnSync('yt-dlp', [
      '--skip-download', '--write-auto-sub', '--write-sub', '--sub-lang', 'en', '--sub-format', 'vtt',
      '-o', join(rawDir, '%(id)s'), video.url,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status === 0 && findVtt(brain.rawDir, video.id)) { fetched++; console.log('  ok'); }
    else { failed++; console.log('  FAILED (no .vtt produced)'); }
  }
}
console.log(`\n${fetched} fetched, ${present} already present, ${failed} failed.`);
if (failed) process.exit(1);
