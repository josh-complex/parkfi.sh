import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

/** A row of at-a-glance metric tiles (park stat bar, account overview, …). */
export function StatCardsSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-2xl border p-4 shadow-sm">
          <Skeleton className="h-3 w-20 rounded-md" />
          <Skeleton className="h-7 w-16 rounded-lg" />
          <Skeleton className="h-3 w-24 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A bordered list/table with a header row and repeated item rows (ride board). */
export function BoardTableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border shadow-sm", className)}>
      <div className="flex items-center gap-4 border-b p-4">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="ml-auto h-4 w-16 rounded-md" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/2 rounded-md" />
              <Skeleton className="h-3 w-1/3 rounded-md" />
            </div>
            <Skeleton className="h-8 w-14 shrink-0 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A responsive grid of media cards (blog posts, pin catalog, dining list). */
export function CardGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
          <Skeleton className="aspect-[16/9] w-full rounded-xl" />
          <Skeleton className="h-5 w-3/4 rounded-md" />
          <Skeleton className="h-4 w-1/2 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A single-entity detail layout: hero image beside a title + meta column. */
export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-4xl space-y-6", className)}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3 rounded-lg" />
          <Skeleton className="h-5 w-1/2 rounded-md" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-10 w-40 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * The router's `defaultPendingComponent`: shown when a loader waits longer than
 * `defaultPendingMs` (150ms). Warm-cache and hover-preloaded navigations resolve
 * faster than that and never see it. Neutral, content-filling shape so it reads
 * as "the page is loading" across dashboard, list, and detail routes without
 * drawing the persistent shell (sidebar/header) around it.
 */
export function RouteSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6" aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-md" />
      </div>
      <StatCardsSkeleton />
      <BoardTableSkeleton />
    </div>
  );
}
