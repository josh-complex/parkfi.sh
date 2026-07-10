import { defineConfig } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Native (Capacitor) build: emit a prerendered SPA shell served for every route
// and bake the absolute API origin in at build time. The Railway web pipeline
// never sets NATIVE_BUILD, so the SSR build stays byte-identical.
const isNativeBuild = process.env.NATIVE_BUILD === "1";

const config = defineConfig({
  define: {
    "import.meta.env.VITE_API_BASE": JSON.stringify(isNativeBuild ? "https://parkfi.sh" : ""),
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: { ignorePatterns: ["src/routeTree.gen.ts", "src/server/og/geist-font.ts"] },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts", "src/server/og/geist-font.ts", ".storybook/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
  // @resvg/resvg-js ships a native .node binary used only by the server-only OG
  // image route. Keep it out of Vite's dep optimizer (which can't parse the
  // binary) and external to the SSR graph; the Nitro build externalizes it too
  // (see rollupConfig.external below).
  optimizeDeps: { exclude: ["@resvg/resvg-js"] },
  ssr: { external: ["@resvg/resvg-js"] },
  plugins: [
    devtools(),
    nitro({
      // Sets `cache-control: no-cache` on the SSR HTML shell so Cloudflare can't
      // serve a stale shell that references hashed chunks a redeploy has deleted
      // (the "Failed to fetch dynamically imported module" PWA crash).
      plugins: ["./src/server/edge/no-cache-html.ts", "./src/server/edge/cors-native.ts"],
      rollupConfig: {
        external: [
          /^@sentry\//,
          /^ioredis/,
          /^bullmq/,
          /^web-push/,
          /^@node-rs\//,
          /^@resvg\//,
          // Capacitor native plugin: its web fallback touches `document` at module
          // scope, which crashes the SPA-shell prerender under Node. It's only ever
          // called on-device (dynamic import in src/lib/native-oauth.ts), so keep it
          // out of the SSR graph entirely.
          /^@capacitor-community\/apple-sign-in/,
        ],
      },
    }),
    tailwindcss(),
    // SPA mode only for the native shell: prerender a shell HTML that Capacitor
    // serves for every route. Web build keeps full SSR (empty opts).
    tanstackStart(
      isNativeBuild
        ? {
            spa: {
              enabled: true,
              // Emit the shell as index.html (default is _shell.html) so
              // Capacitor's webDir has the entry point it expects.
              prerender: { enabled: true, crawlLinks: false, outputPath: "index.html" },
            },
          }
        : {},
    ),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    // The service worker is hand-written and import-free (see public/sw.js); it's
    // served verbatim from the public dir and registered manually in
    // pwa-register.tsx. We dropped vite-plugin-pwa because its bundled worker
    // landed in an orphaned dist/ that Nitro never serves, while Nitro served the
    // raw public/sw.js as a classic worker — so the bundled SW never shipped and
    // the raw one failed to install ("Cannot use import statement outside a module").
  ],
});

export default config;
