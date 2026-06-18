import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { trpcRouter } from "#/integrations/trpc/router";
import { createTRPCContext } from "#/integrations/trpc/init";
import { CACHE, CACHEABLE_TRPC_PATHS } from "#/lib/cache.ts";
import { createFileRoute } from "@tanstack/react-router";

function handler({ request }: { request: Request }) {
  return fetchRequestHandler({
    req: request,
    router: trpcRouter,
    endpoint: "/api/trpc",
    createContext: () => createTRPCContext({ req: request }),
    // Stamp a stale-while-revalidate cache-control on the read-only public query
    // paths so Cloudflare can cache them at the edge. These responses are
    // identical for every user (no per-session variation), and the client routes
    // them through a GET link (see `root-provider.tsx`) so the edge keys on a
    // stable URL. Everything else (mutations, auth-scoped/non-listed queries)
    // stays uncached.
    responseMeta({ paths, type, errors }) {
      if (
        type === "query" &&
        errors.length === 0 &&
        paths &&
        paths.every((p) => CACHEABLE_TRPC_PATHS.has(p))
      ) {
        return { headers: { "cache-control": CACHE.TRPC_DATA } };
      }
      return {};
    },
  });
}

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
