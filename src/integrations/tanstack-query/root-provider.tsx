import type { ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import { createTRPCClient, httpBatchStreamLink, httpLink, splitLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { TRPCRouter } from "#/integrations/trpc/router";
import { TRPCProvider } from "#/integrations/trpc/react";
import { CACHEABLE_TRPC_PATHS } from "#/lib/cache.ts";

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
    defaultOptions: {
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
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
