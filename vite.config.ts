// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        // Supabase Auth depends on tslib. When Nitro bundles for Netlify Functions,
        // the CommonJS tslib entry can be wrapped with an undefined default export.
        // Use tslib's ESM helper entry so SSR imports are stable in production.
        tslib: "tslib/tslib.es6.mjs",
      },
    },
  },
  nitro: {
    // Netlify should run this app in Node Functions, not Edge Functions:
    // the SSR/server bundle depends on Node APIs and server-side Gemini/Supabase code.
    preset: "netlify",
    // Avoid Nitro beta's optional dependency tracer on Netlify Functions.
    // The tracer path fails in this dependency set against @vercel/nft's
    // CommonJS package shape, so bundle the server instead.
    noExternals: true,
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
