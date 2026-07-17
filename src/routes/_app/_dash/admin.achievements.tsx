import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { ACHIEVEMENTS, formatStatValue } from "#/lib/achievements.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/admin/achievements")({
  component: AdminAchievements,
  head: () => seo({ title: "Achievements Admin — ParkFi", noindex: true }),
});

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

function AdminAchievements() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    ...trpc.achievements.adminSearchUsers.queryOptions({ q: debouncedQ }),
    enabled: debouncedQ.length > 0,
  });

  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const detailQ = useQuery({
    ...trpc.achievements.adminUserDetail.queryOptions({ userId: selectedUserId ?? "" }),
    enabled: !!selectedUserId,
  });

  const invalidateDetail = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.achievements.adminUserDetail.queryKey({ userId: selectedUserId ?? "" }),
    });

  const revoke = useMutation(
    trpc.achievements.adminRevoke.mutationOptions({
      onSuccess: (r) => {
        void invalidateDetail();
        toast.success(`Revoked ${r.removed} achievement${r.removed === 1 ? "" : "s"}`);
      },
      onError: (err) => toast.error(err.message || "Could not revoke"),
    }),
  );

  const [alsoAchievements, setAlsoAchievements] = React.useState(false);
  const resetStats = useMutation(
    trpc.achievements.adminResetStats.mutationOptions({
      onSuccess: () => {
        void invalidateDetail();
        toast.success("Stats reset");
      },
      onError: (err) => toast.error(err.message || "Could not reset stats"),
    }),
  );

  // --- device-test-tooling: caller-scoped simulation ------------------------
  const simParksQ = useQuery(trpc.achievements.adminSimParks.queryOptions());
  const [simParkId, setSimParkId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (simParkId == null && simParksQ.data && simParksQ.data.length > 0) {
      setSimParkId(simParksQ.data[0].id);
    }
  }, [simParksQ.data, simParkId]);

  const invalidateObservability = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.achievements.adminGeoCursor.queryKey({ userId: selectedUserId ?? "" }),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.achievements.adminRecentDays.queryKey({ userId: selectedUserId ?? "" }),
    });
  };

  const simulate = useMutation(
    trpc.achievements.adminSimulateScenario.mutationOptions({
      onSuccess: (r) => {
        invalidateObservability();
        toast.success(
          `Ran ${r.pings} pings on your account — ${r.newlyUnlocked.length} new unlock(s). ` +
            `Unlock toasts replay on your next app open.`,
        );
      },
      onError: (err) => toast.error(err.message || "Scenario failed"),
    }),
  );
  const setWeather = useMutation(
    trpc.achievements.adminSetWeather.mutationOptions({
      onSuccess: () => toast.success("Rain observation inserted (2 h window)"),
      onError: (err) => toast.error(err.message || "Could not set weather"),
    }),
  );

  const runSim = (
    preset: "fullParkDay" | "parkHopDay" | "weekendPair" | "streak" | "crossMidnightDwell",
  ) => {
    if (simParkId == null) return;
    const secondParkId =
      preset === "parkHopDay" ? simParksQ.data?.find((p) => p.id !== simParkId)?.id : undefined;
    simulate.mutate({
      preset,
      parkId: simParkId,
      secondParkId,
      days: preset === "streak" ? 7 : undefined,
    });
  };

  const detail = detailQ.data;
  const unlockedByFamily = React.useMemo(() => {
    if (!detail) return [];
    const unlockedIds = new Set(detail.unlocked.map((u) => u.id));
    return ACHIEVEMENTS.map((family) => ({
      family,
      tiers: family.tiers.filter((t) => unlockedIds.has(t.id)),
    })).filter((g) => g.tiers.length > 0);
  }, [detail]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Achievements</h1>
        <p className="text-sm text-muted-foreground">
          Inspect user stats and revoke achievement unlocks for testing. Revoking is the test loop —
          the user's next location ping or tracked event re-evaluates their stats and re-unlocks
          (with toast and buzz) anything they still qualify for.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Time-warp simulation</CardTitle>
          <CardDescription>
            Replays a scripted park day through the real ping engine on <strong>your own</strong>{" "}
            account, with an injected clock — so clock-gated, calendar, and queue families are
            testable in seconds. Unlock toasts replay on your next app open; run these from the
            on-device panel to see them live.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={simParkId ?? ""}
              onChange={(e) => setSimParkId(Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {(simParksQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => runSim("fullParkDay")}
            >
              Full park day
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => runSim("streak")}
            >
              7-day streak
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => runSim("weekendPair")}
            >
              Weekend pair
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => runSim("parkHopDay")}
            >
              Park hop
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => runSim("crossMidnightDwell")}
            >
              Cross-midnight
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={setWeather.isPending || simParkId == null}
              onClick={() => simParkId != null && setWeather.mutate({ parkId: simParkId })}
            >
              Make it rain
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Find a user</CardTitle>
          <CardDescription>Search by email or name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
          {searchQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (searchQ.data?.length ?? 0) > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Unlocks</TableHead>
                  <TableHead className="text-right">—</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searchQ.data?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{u.unlockCount}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelectedUserId(u.id)}>
                        Select
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : debouncedQ ? (
            <p className="text-sm text-muted-foreground">No matches.</p>
          ) : null}
        </CardContent>
      </Card>

      {selectedUserId &&
        (detailQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : detail ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{detail.user.name}</CardTitle>
                <CardDescription>{detail.user.email}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge>
                    Level {detail.level.level} — {detail.level.title}
                  </Badge>
                  <Badge variant="secondary">{detail.xp.toLocaleString()} XP</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ACHIEVEMENTS.map((family) => (
                    <Badge key={family.key} variant="outline">
                      {family.icon} {formatStatValue(family.unit, detail.stats[family.stat] ?? 0)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Unlocks</CardTitle>
                <CardDescription>
                  Grouped by family. Revoke to re-run the test loop.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {unlockedByFamily.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unlocks yet.</p>
                ) : (
                  unlockedByFamily.map(({ family, tiers }) => (
                    <div key={family.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">
                          {family.icon} {family.title}
                        </h3>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() =>
                            revoke.mutate({
                              userId: detail.user.id,
                              achievementIds: tiers.map((t) => t.id),
                            })
                          }
                        >
                          Revoke stack
                        </Button>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tier</TableHead>
                            <TableHead>Unlocked</TableHead>
                            <TableHead>Notified</TableHead>
                            <TableHead className="text-right">—</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tiers.map((tier, i) => {
                            const row = detail.unlocked.find((u) => u.id === tier.id);
                            return (
                              <TableRow key={tier.id}>
                                <TableCell>
                                  {tier.name}{" "}
                                  <span className="text-muted-foreground">
                                    ({i + 1}/{family.tiers.length})
                                  </span>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {formatDate(row?.unlockedAt)}
                                </TableCell>
                                <TableCell>{row?.notifiedAt ? "Yes" : "No"}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={revoke.isPending}
                                    onClick={() =>
                                      revoke.mutate({
                                        userId: detail.user.id,
                                        achievementIds: [tier.id],
                                      })
                                    }
                                  >
                                    Revoke
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
                <CardDescription>Both actions are reversible from the user's side.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="destructive" disabled={detail.unlocked.length === 0} />
                    }
                  >
                    Revoke all achievements
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke every unlock?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Removes all {detail.unlocked.length} unlocked tier(s) for{" "}
                        {detail.user.email}. They'll re-unlock on their next ping or tracked event
                        if they still qualify.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          revoke.mutate({
                            userId: detail.user.id,
                            achievementIds: detail.unlocked.map((u) => u.id),
                          })
                        }
                      >
                        Revoke all
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="outline" />}>
                    Reset stats
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset stats?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Deletes park-day rollups, event counters, and the geo cursor for{" "}
                        {detail.user.email}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={alsoAchievements} onCheckedChange={setAlsoAchievements} />
                      Also revoke achievements
                    </label>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          resetStats.mutate({ userId: detail.user.id, alsoAchievements })
                        }
                      >
                        Reset
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>

            <ObservabilityCards userId={detail.user.id} />
          </>
        ) : null)}
    </div>
  );
}

/**
 * Layer D observability: the live geo cursor (dwell state machine), recent
 * park-day rollups, and recent ride events for a user — so a queue sim or
 * scenario run can be watched tick-by-tick and a failure pinned to the exact
 * transition. All read-only.
 */
function ObservabilityCards({ userId }: { userId: string }) {
  const trpc = useTRPC();
  const [watch, setWatch] = React.useState(false);

  const cursorQ = useQuery({
    ...trpc.achievements.adminGeoCursor.queryOptions({ userId }),
    refetchInterval: watch ? 3000 : false,
  });
  const daysQ = useQuery(trpc.achievements.adminRecentDays.queryOptions({ userId }));
  const ridesQ = useQuery(trpc.achievements.adminRecentRides.queryOptions({ userId }));
  const cursor = cursorQ.data;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Geo cursor</CardTitle>
            <CardDescription>Live dwell state machine for this user.</CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={watch} onCheckedChange={(v) => setWatch(v === true)} />
            Auto-refresh
          </label>
        </CardHeader>
        <CardContent>
          {cursor ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <Stat
                label="Park"
                value={cursor.parkName ?? (cursor.parkId ? `#${cursor.parkId}` : "—")}
              />
              <Stat
                label="Coords"
                value={
                  cursor.lat != null && cursor.lng != null
                    ? `${cursor.lat.toFixed(5)}, ${cursor.lng.toFixed(5)}`
                    : "—"
                }
              />
              <Stat label="Last ping" value={formatDate(cursor.at)} />
              <Stat label="Anchor" value={cursor.anchorName ?? "—"} />
              <Stat label="Anchor secs" value={String(cursor.anchorSeconds)} />
              <Stat label="Anchor since" value={formatDate(cursor.anchorSince)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No geo state yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent park days</CardTitle>
          <CardDescription>Raw rollups with the geo-derived flags.</CardDescription>
        </CardHeader>
        <CardContent>
          {daysQ.data && daysQ.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Park</TableHead>
                  <TableHead>Dist</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Rides</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daysQ.data.map((d) => (
                  <TableRow key={`${d.day}-${d.parkName}`}>
                    <TableCell className="whitespace-nowrap">{d.day}</TableCell>
                    <TableCell>{d.parkName}</TableCell>
                    <TableCell>{Math.round(d.distanceM)} m</TableCell>
                    <TableCell>{Math.round(d.queueSeconds / 60)} min</TableCell>
                    <TableCell>{d.rides}</TableCell>
                    <TableCell className="space-x-1">
                      {d.ropeDrop && <Badge variant="secondary">rope</Badge>}
                      {d.nightOwl && <Badge variant="secondary">owl</Badge>}
                      {d.rainy && <Badge variant="secondary">rain</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No park days yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent rides</CardTitle>
          <CardDescription>Sensor/dwell ride events with their gate source.</CardDescription>
        </CardHeader>
        <CardContent>
          {ridesQ.data && ridesQ.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Attraction</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Metrics</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ridesQ.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.riddenAt)}</TableCell>
                    <TableCell>{r.attractionName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.source}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.metrics
                        ? `${r.metrics.dropCount} drops · maxG ${r.metrics.maxG.toFixed(1)}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No ride events yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}
