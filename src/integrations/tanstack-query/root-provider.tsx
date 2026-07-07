import type { ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import {
  createTRPCClient,
  httpBatchStreamLink,
  httpLink,
  splitLink,
  TRPCClientError,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { TRPCRouter } from "#/integrations/trpc/router";
import { TRPCProvider } from "#/integrations/trpc/react";
import { CACHEABLE_TRPC_PATHS } from "#/lib/cache.ts";
import { reportError } from "#/lib/report-error.ts";

// Type the `meta` bag so call sites get `errorToast` autocompletion and the
// global sinks below read it type-safely.
declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { errorToast?: string | false };
    mutationMeta: { errorToast?: string | false };
  }
}

// tRPC codes that are control flow ("render the empty/login state"), not
// exceptions. On a query we treat these as `expected` telemetry, never a toast.
const EXPECTED_TRPC_CODES = new Set([
  "NOT_FOUND",
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "TOO_MANY_REQUESTS",
]);

function trpcErrorCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | null | undefined)?.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function getUrl() {
  const base = (() => {
    if (typeof window !== "undefined") return "";
    return `http://localhost:${process.env.PORT ?? 3000}`;
  })();
  return `${base}/api/trpc`;
}

export const trpcClient = createTRPCClient<TRPCRouter>({
  links: [
    // Read-only public queries go through a non-batched GET link so each has a
    // stable per-procedure URL Cloudflare can cache (paired with the
    // cache-control stamped in `api.trpc.$.tsx`). Everything else keeps the
    // batched streaming POST link.
    splitLink({
      condition: (op) => op.type === "query" && CACHEABLE_TRPC_PATHS.has(op.path),
      true: httpLink({
        transformer: superjson,
        url: getUrl(),
      }),
      false: httpBatchStreamLink({
        transformer: superjson,
        url: getUrl(),
      }),
    }),
  ],
});

export function getContext() {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const code = trpcErrorCode(error);
        const meta = query.meta;
        // Expected control-flow codes → clean event, no exception/toast — unless
        // a caller explicitly forces a toast message via meta.errorToast.
        const expected =
          code !== undefined &&
          EXPECTED_TRPC_CODES.has(code) &&
          typeof meta?.errorToast !== "string";
        // Background refetch failure keeps showing cached data — degraded. Only
        // the initial load (no cached data) is flow-blocking → critical.
        const initialLoad = query.state.data === undefined;
        reportError(error, {
          source: "query",
          severity: expected ? "expected" : initialLoad ? "critical" : "degraded",
          context: {
            queryKey: JSON.stringify(query.queryKey),
            ...(code ? { trpcCode: code } : {}),
          },
          toast: meta?.errorToast === false ? false : meta?.errorToast,
          toastId: query.queryHash,
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        // The existing per-mutation onError handlers already toast a tailored
        // message. The global sink ALWAYS captures, but only toasts when the
        // mutation has no handler of its own — no double toasts.
        const hasLocalHandler = Boolean(mutation.options.onError);
        const meta = mutation.meta;
        reportError(error, {
          source: "mutation",
          severity: "critical",
          context: { mutationKey: JSON.stringify(mutation.options.mutationKey ?? null) },
          toast: hasLocalHandler || meta?.errorToast === false ? false : meta?.errorToast,
        });
      },
    }),
    defaultOptions: {
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
      queries: {
        // One retry for transient blips on reads; mutations stay retry-free.
        retry: 1,
        // Trust freshly-fetched data for 30s so navigations within the window —
        // including hover-preloaded routes — read from cache instead of
        // refetching from scratch. Live boards resurface newer data on their own
        // refetch cadence, which is coarser than 30s anyway. Per-query overrides
        // (omni-search, POI map, auth, achievements) layer longer windows on top.
        staleTime: 30_000,
        // Keep cache entries warm for a few minutes so back/forward nav is instant.
        gcTime: 5 * 60_000,
      },
    },
  });

  const serverHelpers = createTRPCOptionsProxy({
    client: trpcClient,
    queryClient: queryClient,
  });
  const context = {
    queryClient,
    trpc: serverHelpers,
  };

  return context;
}

export default function TanstackQueryProvider({
  children,
  context,
}: {
  children: ReactNode;
  context: ReturnType<typeof getContext>;
}) {
  const { queryClient } = context;

  return (
    <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
      {children}
    </TRPCProvider>
  );
}
