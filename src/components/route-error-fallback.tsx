import { useRouter } from "@tanstack/react-router";
import { RefreshCwIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "#/components/ui/button";

/**
 * Full-pane fallback rendered by the router's `defaultErrorComponent` (and the
 * root `errorComponent`) when a route's render or loader throws. It replaces the
 * route's content, not the document shell, so it renders fine under SSR — a
 * loader that throws server-side still produces this inside the streamed page.
 *
 * The capture happens in the router's `defaultOnCatch` (see `router.tsx`); this
 * component is purely the user-facing surface, so it never toasts.
 */
export function RouteErrorFallback({ error }: { error: Error }) {
  const router = useRouter();
  const isDev = import.meta.env.DEV;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-14">
      <div className="surface-wash flex w-full max-w-xl flex-col items-center gap-5 p-8 text-center md:p-10">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center justify-center gap-2 text-[11px] font-extrabold tracking-[0.14em] text-wash-fg uppercase">
            <span className="size-[7px] rounded-full bg-brand-yellow" />
            Something broke
          </span>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-balance md:text-[28px]">
            This part of the page didn&rsquo;t load
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground md:text-[15px]">
            We&rsquo;ve logged it. A retry usually fixes it — the rest of the site is unaffected.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="yellow" onClick={() => void router.invalidate()}>
            <RotateCcwIcon className="size-4" />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            <RefreshCwIcon className="size-4" />
            Reload
          </Button>
        </div>

        {isDev ? (
          <pre className="mt-1 max-w-full overflow-x-auto rounded-2xl bg-background/70 p-3 text-left text-xs text-muted-foreground">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
