import type { Env } from "../env";

/** Loosely-typed Workers AI call (model ids come from our own catalog at runtime). */
export function runAi(env: Env, model: string, input: Record<string, unknown>): Promise<unknown> {
  const ai = env.AI as unknown as {
    run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  };
  return ai.run(model, input, {});
}

export const EMBED_BATCH = 100;

/** Embed texts with bge-m3 in batches of ≤ 100. */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = (await runAi(env, env.EMBEDDING_MODEL, { text: batch, truncate_inputs: true })) as {
      data?: number[][];
    };
    if (!res?.data || res.data.length !== batch.length) throw new Error("Embedding model returned no vectors");
    out.push(...res.data);
  }
  return out;
}
