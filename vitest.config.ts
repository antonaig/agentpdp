import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Default environment is node (server tests). Web tests opt into jsdom with
// a `// @vitest-environment jsdom` docblock on line 1.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["server/**/*.test.ts", "web/src/**/*.test.ts", "web/src/**/*.test.tsx", "shared/**/*.test.ts"], exclude: ["e2e/**", "node_modules/**"] },
});
