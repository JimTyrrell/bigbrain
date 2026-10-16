#!/usr/bin/env node
// Upload the seed brains and transcripts to a running BigBrain through its public API.
// Usage: BIGBRAIN_URL=https://bigbrain.example.com BIGBRAIN_PIN=123456 node scripts/seed.mjs [--reset]
import { existsSync, readFileSync } from 'node:fs';
import { loadManifest, contentPath, printTable } from './lib-seeds.mjs';
import { buildSeeds } from './build-seeds.mjs';

const BASE = (process.env.BIGBRAIN_URL ?? '').replace(/\/+$/, '');
const PIN = process.env.BIGBRAIN_PIN ?? '';
const RESET = process.argv.includes('--reset');
const POLL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000;

if (!BASE || !PIN) {
  console.error('Set BIGBRAIN_URL and BIGBRAIN_PIN (the PIN is read from env only and never logged).');
  process.exit(1);
}

let cookie = '';

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const session = res.headers.getSetCookie?.().find((c) => c.startsWith('bb_session='));
  if (session) cookie = session.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: { message: text.slice(0, 200) } }; }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new Error(`${method} ${path} -> ${res.status} ${err.code ?? ''} ${err.message ?? ''}`.trim());
  }
  return data;
}

async function login() {
  const status = await api('GET', '/auth/status');
  if (!status.pinSet) {
    await api('POST', '/auth/setup', { pin: PIN });
    console.log('PIN was not set: configured it from BIGBRAIN_PIN.');
  } else {
    await api('POST', '/auth/login', { pin: PIN });
  }
  if (!cookie) throw new Error('login succeeded but no bb_session cookie was returned');
  console.log(`logged in to ${BASE}`);
}

async function ensureBrain(spec, existing) {
  let brain = existing.find((b) => b.name === spec.name);
  if (brain && RESET) {
    await api('DELETE', `/brains/${brain.id}`);
    console.log(`deleted brain "${spec.name}" (--reset)`);
    brain = null;
  }
  if (!brain) {
    ({ brain } = await api('POST', '/brains', { name: spec.name, description: spec.description }));
    console.log(`created brain "${spec.name}"`);
  } else {
    console.log(`reusing brain "${spec.name}"`);
  }
  return brain;
}

async function waitForIndexing(brainIds) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (true) {
    const all = [];
    for (const id of brainIds) all.push(...(await api('GET', `/brains/${id}/documents`)).documents);
    const pending = all.filter((d) => d.indexStatus === 'pending');
    if (!pending.length) return all;
    if (Date.now() > deadline) throw new Error(`timed out with ${pending.length} document(s) still pending`);
    process.stdout.write(`  waiting for ${pending.length} document(s) to index...\r`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function main() {
  const manifest = loadManifest();
  const needsBuild = manifest.brains.some((b) => b.videos.some((v) => !existsSync(contentPath(b, v))));
  if (needsBuild) {
    console.log('building seed content from .vtt files...');
    if (buildSeeds().missing) throw new Error('some transcripts are missing; run scripts/fetch-transcripts.mjs');
  }

  await login();
  const { brains: existing } = await api('GET', '/brains');
  const brainIds = [];
  const names = {};
  for (const spec of manifest.brains) {
    const brain = await ensureBrain(spec, existing);
    brainIds.push(brain.id);
    names[brain.id] = spec.name;
    const { documents } = await api('GET', `/brains/${brain.id}/documents`);
    const have = new Set(documents.map((d) => d.sourceUrl).filter(Boolean));
    for (const video of spec.videos) {
      if (have.has(video.url)) { console.log(`  skip (exists): ${video.title}`); continue; }
      const content = readFileSync(contentPath(spec, video), 'utf8');
      await api('POST', `/brains/${brain.id}/documents`, {
        title: video.title, content, sourceUrl: video.url, sourceType: 'transcript',
      });
      console.log(`  uploaded: ${video.title}`);
    }
  }

  const docs = await waitForIndexing(brainIds);
  console.log('');
  printTable(docs.map((d) => ({
    brain: names[d.brainId] ?? d.brainId,
    title: d.title.length > 60 ? `${d.title.slice(0, 57)}...` : d.title,
    status: d.indexStatus,
    chunks: d.chunkCount,
    error: d.indexError ?? '',
  })));
  const errors = docs.filter((d) => d.indexStatus === 'error');
  if (errors.length) throw new Error(`${errors.length} document(s) failed to index`);
  console.log('\nseed complete.');
}

main().catch((err) => {
  console.error(`seed failed: ${err.message}`);
  process.exit(1);
});
