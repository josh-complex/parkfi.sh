import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Table, TableBody, TableCell, TableRow } from "#/components/ui/table.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/admin/alerts")({
  component: AdminAlerts,
  head: () => seo({ title: "Alerts Admin — ParkFi", noindex: true }),
});

interface PickedUser {
  id: string;
  email: string;
  name: string;
}

/** Debounced email/name search that resolves to one selected user. */
function UserPicker({
  selected,
  onSelect,
}: {
  selected: PickedUser | null;
  onSelect: (u: PickedUser | null) => void;
}) {
  const trpc = useTRPC();
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    ...trpc.achievements.adminSearchUsers.queryOptions({ q: debouncedQ }),
    enabled: debouncedQ.length > 0 && !selected,
  });

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected.name}</p>
          <p className="text-muted-foreground truncate text-xs">{selected.email}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input placeholder="email or name…" value={q} onChange={(e) => setQ(e.target.value)} />
      {searchQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (searchQ.data?.length ?? 0) > 0 ? (
        <Table>
          <TableBody>
            {searchQ.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="py-1.5">
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-muted-foreground text-xs">{u.email}</p>
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelect({ id: u.id, email: u.email, name: u.name })}
                  >
                    Select
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : debouncedQ ? (
        <p className="text-muted-foreground text-sm">No matches.</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run sweeps now
// ---------------------------------------------------------------------------

function SweepsCard() {
  const trpc = useTRPC();
  const diningSweep = useMutation(
    trpc.adminAlerts.runDiningSweep.mutationOptions({
      onSuccess: (r) => toast.success(`Dining sweep fired ${r.fired} alert(s)`),
      onError: (err) => toast.error(err.message || "Sweep failed"),
    }),
  );
  const rideSweep = useMutation(
    trpc.adminAlerts.runRideSweep.mutationOptions({
      onSuccess: (r) => toast.success(`Ride/Lightning Lane sweep fired ${r.fired} alert(s)`),
      onError: (err) => toast.error(err.message || "Sweep failed"),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run a sweep now</CardTitle>
        <CardDescription>
          Evaluates every active alert against live data right now, instead of waiting for the next
          cron tick. Fires real push/email for whatever currently matches.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button disabled={diningSweep.isPending} onClick={() => diningSweep.mutate()}>
          {diningSweep.isPending ? "Running…" : "Run dining sweep"}
        </Button>
        <Button variant="outline" disabled={rideSweep.isPending} onClick={() => rideSweep.mutate()}>
          {rideSweep.isPending ? "Running…" : "Run ride / Lightning Lane sweep"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Send a test push
// ---------------------------------------------------------------------------

function TestPushCard() {
  const trpc = useTRPC();
  const [user, setUser] = React.useState<PickedUser | null>(null);
  const [title, setTitle] = React.useState("Test notification");
  const [body, setBody] = React.useState("This is a test push from the admin panel.");
  const [url, setUrl] = React.useState("/dining");

  const send = useMutation(
    trpc.adminAlerts.sendTestPush.mutationOptions({
      onSuccess: () => toast.success("Push enqueued — check the target device"),
      onError: (err) => toast.error(err.message || "Could not send push"),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a test push</CardTitle>
        <CardDescription>
          Enqueues an arbitrary push straight through the real `push-notifications` queue —
          delivered only if the user has a registered device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Recipient</Label>
          <UserPicker selected={user} onSelect={setUser} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="push-title">Title</Label>
          <Input id="push-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="push-body">Body</Label>
          <Textarea id="push-body" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="push-url">Tap-through URL (optional)</Label>
          <Input id="push-url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <Button
          disabled={!user || send.isPending}
          onClick={() =>
            user &&
            send.mutate({ userId: user.id, title, body, url: url.trim() ? url.trim() : undefined })
          }
        >
          {send.isPending ? "Sending…" : "Send push"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Force-fire a dining alert
// ---------------------------------------------------------------------------

function ForceFireDiningCard() {
  const trpc = useTRPC();
  const [user, setUser] = React.useState<PickedUser | null>(null);
  const [alertId, setAlertId] = React.useState<string>("");
  const [facilityId, setFacilityId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("18:00");

  const alertsQ = useQuery({
    ...trpc.adminAlerts.userDiningAlerts.queryOptions({ userId: user?.id ?? "" }),
    enabled: !!user,
  });
  const alerts = alertsQ.data ?? [];
  const selectedAlert = alerts.find((a) => String(a.id) === alertId);

  const fire = useMutation(
    trpc.adminAlerts.forceFireDiningAlert.mutationOptions({
      onSuccess: (r) =>
        toast.success(`Fired: ${r.payload.subject}`, {
          action: r.payload.deepLink
            ? {
                label: "Open in Disney App",
                onClick: () => window.open(r.payload.deepLink!, "_blank"),
              }
            : undefined,
        }),
      onError: (err) => toast.error(err.message || "Could not fire alert"),
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Force-fire a dining alert</CardTitle>
        <CardDescription>
          Runs the exact push + email + mdx-deep-link delivery a live sweep would, using an
          admin-supplied "matched" offer instead of waiting for real availability. Pick one of the
          user's existing alerts — create one from the dining page first if they have none.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>User</Label>
          <UserPicker
            selected={user}
            onSelect={(u) => {
              setUser(u);
              setAlertId("");
            }}
          />
        </div>

        {user ? (
          alertsQ.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : alerts.length === 0 ? (
            <p className="text-muted-foreground text-sm">This user has no active dining alerts.</p>
          ) : (
            <div className="space-y-1.5">
              <Label>Alert</Label>
              <Select
                value={alertId}
                onValueChange={(v) => v && setAlertId(v)}
                items={Object.fromEntries(
                  alerts.map((a) => [
                    String(a.id),
                    `${a.restaurantName} · party of ${a.partySize}`,
                  ]),
                )}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick an alert" />
                </SelectTrigger>
                <SelectContent>
                  {alerts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.restaurantName} · party of {a.partySize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        ) : null}

        {selectedAlert ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ff-facility">
                Facility id{!selectedAlert.facilityId ? " (required — “any restaurant”)" : ""}
              </Label>
              <Input
                id="ff-facility"
                placeholder={selectedAlert.facilityId || "e.g. 90001234"}
                value={facilityId}
                onChange={(e) => setFacilityId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ff-date">Matched date (default: today)</Label>
              <Input
                id="ff-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ff-time">Matched time</Label>
              <Input
                id="ff-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <Button
          disabled={!selectedAlert || fire.isPending}
          onClick={() =>
            selectedAlert &&
            fire.mutate({
              alertId: selectedAlert.id,
              matchedFacilityId: facilityId.trim() || undefined,
              matchedDate: date || undefined,
              matchedOfferTime: time || undefined,
            })
          }
        >
          {fire.isPending ? "Firing…" : "Fire alert"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AdminAlerts() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Debug tools for the dining / ride / Lightning Lane alert pipelines. Everything here talks
          to the real queues and workers — no mocks.
        </p>
      </header>

      <SweepsCard />
      <TestPushCard />
      <ForceFireDiningCard />
    </div>
  );
}
