import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The art bundle is pinned to IPFS and served as `animation_url`, so it has to
 * be a single self-contained file: no code splitting, no external requests. The
 * glyph font is inlined as a data URI by `src/font.ts`.
 */
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
