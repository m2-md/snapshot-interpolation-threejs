import { defineConfig } from "vite";

// Demo modern hedefle derlenir (three r185 ESM). Testler ve `npm run bench`
// vitest / vite-node'un node ortamında koşar — tarayıcı, canvas ya da WebGL
// bağlamı gerekmez: bu projede snapshot hattının tamamı saf mantık.
export default defineConfig({
  build: {
    target: "esnext",
  },
  esbuild: {
    target: "esnext",
  },
});
