/** Worker bindings and vars (mirrors wrangler.jsonc; see worker-configuration.d.ts). */
export interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  KV: KVNamespace;
  ASSETS: Fetcher;
  DEFAULT_MODEL: string;
  EMBEDDING_MODEL: string;
  WHISPER_MODEL: string;
}

export type AppEnv = { Bindings: Env };
