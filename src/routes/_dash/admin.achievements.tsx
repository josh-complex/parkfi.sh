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

export const Route = createFileRoute("/_dash/admin/achievements")({
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
          </>
        ) : null)}
    </div>
  );
}
