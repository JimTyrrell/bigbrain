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
  /** KV namespace id of BIGBRAIN_KV (used to deep-link the PIN reset guide). Optional. */
  KV_NAMESPACE_ID?: string;
  /** Canonical public URL of the site. Optional. */
  PUBLIC_URL?: string;
}

export type AppEnv = { Bindings: Env };
