import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
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
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/admin/removal-requests")({
  component: AdminRemovalRequests,
  head: () => seo({ title: "Removal Requests — ParkFi", noindex: true }),
});

// Mirror of MAINTENANCE_FEATURES in the removal router (kept literal client-side
// so this panel needs no extra round-trip to enumerate toggleable features).
const FEATURES = ["dining", "tickets", "stays", "predictions", "pins"] as const;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default",
  acknowledged: "secondary",
  actioned: "outline",
  declined: "destructive",
};

/** "listing" scope suppresses the whole entity ("*"); others map to a field. */
function suppressFieldFor(targetField: string | null): string {
  return targetField && targetField !== "listing" ? targetField : "*";
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

function AdminRemovalRequests() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listQ = useQuery(trpc.removal.list.queryOptions({}));

  const resolve = useMutation(
    trpc.removal.resolve.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.removal.list.queryKey() });
        toast.success("Request updated");
      },
      onError: (err) => toast.error(err.message || "Could not update request"),
    }),
  );

  const requests = listQ.data ?? [];

  const featuresQ = useQuery(trpc.removal.features.queryOptions());
  const offline = new Set(featuresQ.data ?? []);
  const setMaintenance = useMutation(
    trpc.removal.setFeatureMaintenance.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.removal.features.queryKey() });
        toast.success("Maintenance state updated");
      },
      onError: (err) => toast.error(err.message || "Could not update maintenance"),
    }),
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Feature maintenance</CardTitle>
          <CardDescription>
            Take a whole section offline. Visitors see a construction screen in place of the page;
            everything else keeps working. Reversible at any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {FEATURES.map((f) => {
              const isOff = offline.has(f);
              const pending = setMaintenance.isPending && setMaintenance.variables?.feature === f;
              return (
                <Button
                  key={f}
                  size="sm"
                  variant={isOff ? "destructive" : "outline"}
                  disabled={pending}
                  onClick={() => setMaintenance.mutate({ feature: f, on: !isOff })}
                >
                  {isOff ? `${f}: offline — bring back` : f}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content removal requests</CardTitle>
          <CardDescription>
            Requests filed by verified cast members. Actioning a request hides the reported content
            via a reversible suppression; declining leaves it in place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => {
                  const pending = resolve.isPending && resolve.variables?.id === r.id;
                  const resolved = r.status === "actioned" || r.status === "declined";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(r.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {r.entityType}/{r.entityId}
                      </TableCell>
                      <TableCell>{r.targetField ?? "listing"}</TableCell>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell className="max-w-xs truncate" title={r.note ?? ""}>
                        {r.note ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {resolved ? (
                          <span className="text-xs text-muted-foreground">
                            {r.status === "actioned" ? "Hidden" : "Kept"}
                          </span>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                resolve.mutate({
                                  id: r.id,
                                  status: "actioned",
                                  suppressField: suppressFieldFor(r.targetField),
                                })
                              }
                            >
                              Action &amp; hide
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => resolve.mutate({ id: r.id, status: "declined" })}
                            >
                              Decline
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
