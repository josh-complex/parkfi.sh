import { defineConfig } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
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
      plugins: ["./src/server/edge/no-cache-html.ts"],
      rollupConfig: {
        external: [/^@sentry\//, /^ioredis/, /^bullmq/, /^web-push/, /^@node-rs\//, /^@resvg\//],
      },
    }),
    tailwindcss(),
    tanstackStart(),
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
