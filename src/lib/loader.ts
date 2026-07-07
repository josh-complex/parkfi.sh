import { isServer } from "@tanstack/react-query";

import type { EnsureQueryDataOptions, QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Split a route loader's data fetch by environment so the SEO contract and
 * client responsiveness both hold:
 *
 * - **Server** (SSR / crawler document requests): `ensureQueryData` — awaited,
 *   blocking, so the data is present in the HTML. `/api/trpc` is disallowed in
 *   robots.txt, so crawlers only ever see what the server renders.
 * - **Client** (in-app navigation): `prefetchQuery` — fire-and-forget, so the
 *   route (and its skeletons) render immediately instead of freezing the old
 *   page until the query resolves.
 *
 * Use it as `await load(qc, opts)`: on the server this blocks on the real
 * fetch; on the client `await undefined` resolves on the next microtask, so the
 * loader returns without waiting for the network. When the loader needs the
 * value (e.g. for `head()` copy), the server path returns it and the client
 * path returns `undefined` — fall back accordingly.
 *
 * Routes that `throw notFound()` off the result should NOT use this helper for
 * that query; branch on `isServer` directly so the server still 404s while the
 * client defers the not-found decision to the component.
 */
export function load<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
): Promise<TData> | undefined {
  if (isServer) return queryClient.ensureQueryData(options);
  void queryClient.prefetchQuery(options);
  return undefined;
}
