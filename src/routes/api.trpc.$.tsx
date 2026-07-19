import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { trpcRouter } from "#/integrations/trpc/router";
import { createTRPCContext } from "#/integrations/trpc/init";
import { trpcCacheControl } from "#/lib/cache.ts";
import { serverPostHog } from "#/server/posthog.ts";
import { createFileRoute } from "@tanstack/react-router";

function handler({ request }: { request: Request }) {
  return fetchRequestHandler({
    req: request,
    router: trpcRouter,
    endpoint: "/api/trpc",
    createContext: () => createTRPCContext({ req: request }),
    onError({ error, path, type, ctx }) {
      // Expected control-flow codes (NOT_FOUND/UNAUTHORIZED/BAD_REQUEST/…) are the
      // client's problem — the query sink in root-provider.tsx classifies those.
      // Only genuine server faults become server-side exceptions.
      if (error.code !== "INTERNAL_SERVER_ERROR" && error.code !== "TIMEOUT") return;
      // eslint-disable-next-line no-console
      console.error(`[trpc] ${type} ${path} failed:`, error);
      // `error.cause` preserves the original stack when a router wraps a DB error
      // in TRPCError. Thread the Better-Auth user id so server exceptions join the
      // user's event stream (falls back to "server" for anonymous callers).
      serverPostHog()?.captureException(error.cause ?? error, ctx?.userId ?? "server", {
        source: "trpc-server",
        trpc_path: path,
        trpc_type: type,
        service: "web",
      });
    },
    // Stamp a stale-while-revalidate cache-control on the read-only public query
    // paths so Cloudflare can cache them at the edge. These responses are
    // identical for every user (no per-session variation), and the client routes
    // them through a GET link (see `root-provider.tsx`) so the edge keys on a
    // stable URL. `trpcCacheControl` picks the per-path policy (and the shortest
    // TTL if a batch ever mixes paths), returning undefined for any unlisted
    // path so mutations and auth-scoped/non-listed queries stay uncached.
    responseMeta({ paths, type, errors }) {
      if (type === "query" && errors.length === 0 && paths) {
        const cacheControl = trpcCacheControl(paths);
        if (cacheControl) return { headers: { "cache-control": cacheControl } };
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
