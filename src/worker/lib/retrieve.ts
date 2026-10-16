import type { Env } from "../env";
import { embed } from "./ai";
import { stripMarkers, timestampSeconds } from "./chunk";
import type { Citation } from "./db";

export const TOP_K = 8;

/** Source URL with `t=<seconds>s` so the link jumps to the quoted moment. */
export function linkFor(sourceUrl: string | null, timestamp: string | null): string | null {
  if (!sourceUrl || !timestamp) return null;
  try {
    const u = new URL(sourceUrl);
    u.searchParams.set("t", `${timestampSeconds(timestamp)}s`);
    return u.toString();
  } catch {
    return null;
  }
}

/** Retrieve the top passages for a question, numbered 1..n in relevance order. */
export async function retrieve(env: Env, brainId: string, question: string): Promise<Citation[]> {
  const [vector] = await embed(env, [question]);
  const res = await env.VECTORIZE.query(vector, { topK: TOP_K, filter: { brain_id: brainId }, returnMetadata: "indexed" });
  const ids = res.matches.map((m) => m.id);
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.text, c.timestamp, c.document_id, d.title, d.source_url
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.brain_id = ? AND c.id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(brainId, ...ids)
    .all<{ id: string; text: string; timestamp: string | null; document_id: string; title: string; source_url: string | null }>();
  const byId = new Map(results.map((r) => [r.id, r]));
  const citations: Citation[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue; // stale vector
    citations.push({
      n: citations.length + 1,
      documentId: r.document_id,
      documentTitle: r.title,
      chunkId: r.id,
      timestamp: r.timestamp,
      sourceUrl: r.source_url,
      link: linkFor(r.source_url, r.timestamp),
      excerpt: stripMarkers(r.text),
    });
  }
  return citations;
}

/** Keep citations referenced as [n] in the reply; fall back to all of them. */
export function filterCited(reply: string, citations: Citation[]): Citation[] {
  const used = new Set<number>();
  for (const m of reply.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of m[1].split(",")) used.add(Number(n.trim()));
  }
  const cited = citations.filter((c) => used.has(c.n));
  return cited.length ? cited : citations;
}
