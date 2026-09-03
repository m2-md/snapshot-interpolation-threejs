import { defineConfig } from "vite";

// The demo compiles to a modern target (three r185 ESM). Tests and `npm run bench`
// run in the node environment via vitest / vite-node — no browser, canvas, or WebGL
// context is needed: in this project, the entire snapshot pipeline is pure logic.
export default defineConfig({
  build: {
    target: "esnext",
  },
  esbuild: {
    target: "esnext",
  },
});
