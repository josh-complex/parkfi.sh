"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { KIND_LABELS, RESORT_LABELS } from "#/components/records/record-card.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect } from "#/components/ui/native-select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import type { PublicRecordKind } from "#/lib/records.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Filing watches (public-records plan §6.3). A watch is scope × kinds ×
 * keywords × channel; the public-records cron evaluates it after each daily
 * sweep and edge-triggers per (watch, record), so a new watch never replays the
 * back catalog — it starts from the next sweep.
 *
 * The kinds offered are the ones we actually ingest today; the rest of the
 * vocabulary exists in the ledger but has no adapter yet, so offering it would
 * promise alerts that can't fire.
 */
const WATCHABLE_KINDS: PublicRecordKind[] = [
  "permit",
  "trademark",
  "patent_app",
  "patent_grant",
  "airspace",
  "erp",
];

const RESORT_OPTIONS = [
  { value: "", label: "Both resorts" },
  { value: "walt-disney-world", label: "Walt Disney World" },
  { value: "universal-orlando", label: "Universal Orlando" },
];

function scopeLabel(w: {
  resortSlug: string | null;
  parkName: string | null;
  entityKind: string | null;
  entityId: string | null;
  entityName?: string | null;
}): string {
  // Most specific scope first: an entity watch (a ride, a restaurant) pins its
  // park too, but the entity is what the user asked for.
  if (w.entityKind && w.entityId) return w.entityName ?? `${w.entityKind} ${w.entityId}`;
  if (w.parkName) return w.parkName;
  if (w.resortSlug) return (RESORT_LABELS[w.resortSlug] ?? w.resortSlug) as string;
  return "All filings";
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const trpc = useTRPC();
  const [resortSlug, setResortSlug] = React.useState("");
  const [kinds, setKinds] = React.useState<PublicRecordKind[]>([]);
  const [keyword, setKeyword] = React.useState("");
  const [channel, setChannel] = React.useState<"push" | "email" | "both">("both");

  const create = useMutation(
    trpc.filingWatches.create.mutationOptions({
      onSuccess: () => {
        setKeyword("");
        setKinds([]);
        onCreated();
        toast.success("Watching — we'll tell you what gets filed next.");
      },
      onError: (err) => toast.error(err.message || "Could not create the watch"),
    }),
  );

  const toggleKind = (k: PublicRecordKind) =>
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          size="sm"
          value={resortSlug}
          onChange={(e) => setResortSlug(e.target.value)}
          aria-label="Resort"
        >
          {RESORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          size="sm"
          value={channel}
          onChange={(e) => setChannel(e.target.value as "push" | "email" | "both")}
          aria-label="How to notify me"
        >
          <option value="both">Email + push</option>
          <option value="email">Email only</option>
          <option value="push">Push only</option>
        </NativeSelect>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {WATCHABLE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kinds.includes(k)}
            onClick={() => toggleKind(k)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              kinds.includes(k)
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            {KIND_LABELS[k] ?? k}
          </button>
        ))}
      </div>

      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="Optional keyword — e.g. a project name or a ride"
        maxLength={60}
      />
      <p className="text-muted-foreground text-xs">
        Leave the kinds empty to watch everything in scope. A keyword matches the filing's own
        title, description and filer — nothing is inferred beyond the words in the record.
      </p>

      <Button
        size="sm"
        disabled={create.isPending}
        onClick={() =>
          create.mutate({
            resortSlug: resortSlug || undefined,
            kinds,
            keywords: keyword.trim().length >= 2 ? [keyword.trim()] : [],
            channel,
          })
        }
      >
        {create.isPending ? "Saving…" : "Watch filings"}
      </Button>
    </div>
  );
}

/** Lists + creates the user's filing watches. Mirrors `DiningAlertsManager`. */
export function FilingWatchesManager() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const watchesQ = useQuery({
    ...trpc.filingWatches.list.queryOptions(),
    enabled: !!session?.user,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: trpc.filingWatches.list.queryKey() });

  const remove = useMutation(
    trpc.filingWatches.remove.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Watch removed");
      },
      onError: (err) => toast.error(err.message || "Could not remove the watch"),
    }),
  );

  if (isPending) return <Skeleton className="h-20 w-full rounded-xl" />;

  if (!session?.user) {
    return (
      <Empty>
        <EmptyTitle>Sign in to watch filings</EmptyTitle>
        <EmptyDescription>
          Filing watches are tied to your account so we know where to notify you.
        </EmptyDescription>
        <Button className="mt-4" render={<LoginLink />}>
          Sign in
        </Button>
      </Empty>
    );
  }

  const watches = watchesQ.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        We'll tell you when a new permit, trademark or airspace study shows up in the public record.
        {watches.length > 0 ? ` ${watches.length} of 3 used.` : ""}
      </p>

      {watchesQ.isLoading ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : watches.length === 0 ? (
        <Empty>
          <FileTextIcon className="text-muted-foreground size-6" />
          <EmptyTitle>No filing watches yet</EmptyTitle>
          <EmptyDescription>
            Watch a resort to hear about permits and trademarks as they're filed.
          </EmptyDescription>
          <Button className="mt-4" variant="outline" render={<Link to="/filings" />}>
            Browse filings
          </Button>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {watches.map((w) => (
            <li
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{scopeLabel(w)}</span>
                  {!w.active ? <Badge variant="secondary">Paused</Badge> : null}
                </div>
                <p className="text-muted-foreground text-sm">
                  {w.kinds.length === 0
                    ? "All filing kinds"
                    : w.kinds.map((k) => KIND_LABELS[k] ?? k).join(", ")}
                  {w.keywords.length > 0 ? ` · “${w.keywords.join("”, “")}”` : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {w.channel === "both" ? "Email + push" : w.channel === "email" ? "Email" : "Push"}
                  {w.lastFiredAt
                    ? ` · last sent ${new Date(w.lastFiredAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}`
                    : " · nothing sent yet"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: w.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {watches.length < 3 ? <CreateForm onCreated={invalidate} /> : null}
    </div>
  );
}
