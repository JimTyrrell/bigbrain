import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The web app lives in src/web and builds to dist/web, which the Worker serves as static assets.
export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  // Proxy API calls to `wrangler dev`, but not the SPA's own source modules under src/web/api/*.ts.
  server: { proxy: { "^/api/(?![^?]*\\.tsx?(?:\\?|$))": "http://localhost:8787" } },
});
