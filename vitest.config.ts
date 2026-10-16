import { defineConfig } from "vitest/config";

// Unit tests are pure (WebCrypto, streams, string processing; no D1/Vectorize/AI bindings),
// so they run in plain Node and in CI without Cloudflare credentials.
// Note: @cloudflare/vitest-pool-workers@0.23 only supports vitest ^4.1 and fails to start
// under the installed vitest 5, so the Workers pool is not used here.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
