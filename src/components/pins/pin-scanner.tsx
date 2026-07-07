"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraIcon, CheckCircle2Icon } from "lucide-react";
import { toast } from "sonner";

import { PinImage } from "#/components/pins/pin-card.tsx";
import { formatCents } from "#/components/pins/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Guided pin-capture flow. Capture a photo, send it to the identify pipeline,
 * poll for candidates, and let the user confirm the right match. Scanning works
 * logged-out; confirming requires sign-in.
 */
export function PinScanner() {
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const loggedIn = !!session?.user;
  const track = useAchievementTrack();

  const [scanId, setScanId] = React.useState<string | null>(null);
  const [confirmedPinId, setConfirmedPinId] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const scan = useMutation(
    trpc.pinIdentify.scan.mutationOptions({
      onSuccess: (res) => setScanId(res.scanId),
      onError: (err) => toast.error(err.message || "Could not start scan"),
    }),
  );

  const resultQ = useQuery({
    ...trpc.pinIdentify.result.queryOptions({ scanId: scanId ?? "" }),
    enabled: !!scanId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "processing" ? 1500 : false;
    },
  });

  const confirm = useMutation(
    trpc.pinIdentify.confirm.mutationOptions({
      onSuccess: (_res, vars) => {
        setConfirmedPinId(vars.chosenPinId);
        void queryClient.invalidateQueries({ queryKey: trpc.pinCollection.list.queryKey() });
        toast.success(vars.chosenPinId ? "Pin confirmed" : "Thanks — we'll keep looking");
        if (vars.chosenPinId) track("pin_scan");
      },
      onError: (err) => toast.error(err.message || "Could not confirm"),
    }),
  );

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanId(null);
    setConfirmedPinId(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result;
      if (typeof dataUri === "string") scan.mutate({ dataUri });
    };
    reader.onerror = () => toast.error("Could not read that image");
    reader.readAsDataURL(file);
  }

  function reset() {
    setScanId(null);
    setConfirmedPinId(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const result = resultQ.data;
  const busy = scan.isPending || result?.status === "queued" || result?.status === "processing";

  // After a positive confirm: success state with links onward.
  const chosen = confirmedPinId
    ? result?.candidates.find((c) => c.pinId === confirmedPinId)
    : undefined;

  if (confirmedPinId && chosen) {
    return (
      <div className="space-y-4 rounded-2xl border p-6 text-center">
        <CheckCircle2Icon className="text-primary mx-auto size-10" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Identified {chosen.name}</h2>
          <p className="text-muted-foreground text-sm">Added to your scan history.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button render={<Link to="/pins/$pinId" params={{ pinId: chosen.pinId }} />}>
            View pin
          </Button>
          <Button variant="outline" render={<Link to="/pins/collection" />}>
            Add to collection
          </Button>
          <Button variant="ghost" onClick={reset}>
            Scan another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onFile}
      />

      {!scanId ? (
        <div className="space-y-4 rounded-2xl border border-dashed p-8 text-center">
          <CameraIcon className="text-muted-foreground mx-auto size-10" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Scan a pin</h2>
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              Lay the pin flat on a plain surface in good light, fit one pin in the frame, and fill
              as much of it as you can.
            </p>
          </div>
          <Button onClick={() => fileRef.current?.click()} disabled={scan.isPending}>
            <CameraIcon />
            {scan.isPending ? "Uploading…" : "Take a photo"}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-4">
            <PinImage
              src={result?.photoUrl}
              alt="Captured pin"
              className="size-28 shrink-0 rounded-2xl border bg-muted"
            />
            <div className="min-w-0 flex-1 space-y-2">
              {busy ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Spinner /> Identifying your pin…
                </p>
              ) : result?.status === "failed" ? (
                <p className="text-destructive text-sm">
                  {result.error || "We couldn't read that photo. Try again with better light."}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {result?.candidates.length
                    ? "Tap the closest match below."
                    : "No matches found for this photo."}
                </p>
              )}
              <Button variant="outline" size="sm" onClick={reset}>
                Retake photo
              </Button>
            </div>
          </div>

          {result?.status === "ready" && result.candidates.length > 0 ? (
            <div className="space-y-2">
              {result.candidates.map((c, i) => {
                const top = i === 0 && result.topConfidence != null;
                return (
                  <div
                    key={c.pinId}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-3",
                      top && "border-primary/40 bg-accent/8",
                    )}
                  >
                    <PinImage
                      src={c.imageUrl}
                      alt={c.name}
                      className="size-14 shrink-0 rounded-lg bg-muted"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        {top ? (
                          <Badge variant="secondary" className="shrink-0">
                            {Math.round((result.topConfidence ?? 0) * 100)}% match
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground truncate text-xs">
                        {[c.series, c.year != null ? String(c.year) : null, c.editionType]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="text-xs font-semibold tabular-nums">
                        {formatCents(c.estValueCents)}
                      </p>
                    </div>
                    {loggedIn && scanId ? (
                      <Button
                        size="sm"
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate({ scanId, chosenPinId: c.pinId })}
                      >
                        This one
                      </Button>
                    ) : null}
                  </div>
                );
              })}

              {loggedIn && scanId ? (
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate({ scanId, chosenPinId: null })}
                >
                  None of these / not listed
                </Button>
              ) : (
                <div className="space-y-2 rounded-2xl border bg-muted/40 p-4 text-center">
                  <p className="text-muted-foreground text-sm">
                    Sign in to confirm a match and save it to your collection.
                  </p>
                  <Button size="sm" render={<Link to="/login" />}>
                    Sign in
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
