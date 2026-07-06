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
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          This part of the app hit an error. You can retry, or reload the page.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="default" size="sm" onClick={() => void router.invalidate()}>
          <RotateCcwIcon className="size-4" />
          Try again
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
        >
          <RefreshCwIcon className="size-4" />
          Reload
        </Button>
      </div>

      {isDev ? (
        <pre className="bg-muted text-muted-foreground mt-2 max-w-full overflow-x-auto rounded-md p-3 text-left text-xs">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
      ) : null}
    </div>
  );
}
