#!/usr/bin/env node
// Convert every manifest video's .vtt into seeds/content/<brain-slug>/<id>.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vttToMarkdown } from './vtt-to-markdown.mjs';
import { ROOT, loadManifest, findVtt, contentPath, printTable } from './lib-seeds.mjs';

export function buildSeeds() {
  const rows = [];
  let missing = 0;
  for (const brain of loadManifest().brains) {
    for (const video of brain.videos) {
      const vtt = findVtt(brain.rawDir, video.id);
      if (!vtt) {
        console.error(`missing .vtt for ${brain.name} / ${video.id} in ${brain.rawDir} (run scripts/fetch-transcripts.mjs)`);
        missing++;
        continue;
      }
      const md = vttToMarkdown(readFileSync(vtt, 'utf8'), { title: video.title, url: video.url });
      const out = contentPath(brain, video);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, md);
      const body = md.split('\n').slice(3).join('\n');
      rows.push({
        brain: brain.name,
        title: video.title.length > 60 ? `${video.title.slice(0, 57)}...` : video.title,
        words: body.replace(/\[[\d:]+\]/g, '').split(/\s+/).filter(Boolean).length,
        paragraphs: (body.match(/^\[[\d:]+\]/gm) ?? []).length,
        file: relative(ROOT, out),
      });
    }
  }
  return { rows, missing };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { rows, missing } = buildSeeds();
  printTable(rows);
  console.log(`\n${rows.length} transcript(s) written${missing ? `, ${missing} missing` : ''}.`);
  if (missing) process.exit(1);
}
