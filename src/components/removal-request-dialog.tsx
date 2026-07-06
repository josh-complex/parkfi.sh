import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { FlagIcon } from "lucide-react";
import { toast } from "sonner";

import { useIsCastMember } from "#/components/cast-member-badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

type EntityType = "park" | "attraction" | "restaurant" | "shop" | "resort";
type Scope = "listing" | "image" | "menu";
type Reason = "inaccurate" | "unauthorized_media" | "confidential" | "other";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "listing", label: "This whole listing" },
  { value: "image", label: "A photo or image" },
  { value: "menu", label: "Menu content" },
];

const REASONS: { value: Reason; label: string }[] = [
  { value: "inaccurate", label: "Inaccurate or outdated" },
  { value: "unauthorized_media", label: "Unauthorized image or media" },
  { value: "confidential", label: "Confidential — should not be public" },
  { value: "other", label: "Other" },
];

/**
 * "Report or request removal" affordance for the Disney entity pages. Renders
 * nothing unless the signed-in user is a verified cast member, so pages can drop
 * it in unconditionally. Submits to the review queue (`trpc.removal.submit`);
 * an admin decides what actually happens.
 */
export function RemovalRequestDialog({
  entityType,
  entityId,
  entityName,
}: {
  entityType: EntityType;
  entityId: string;
  entityName?: string;
}) {
  const isCastMember = useIsCastMember();
  const trpc = useTRPC();
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<Scope>("listing");
  const [reason, setReason] = React.useState<Reason>("inaccurate");
  const [note, setNote] = React.useState("");

  const submit = useMutation(
    trpc.removal.submit.mutationOptions({
      onSuccess: () => {
        setOpen(false);
        setNote("");
        toast.success("Thanks — our team will review this.");
      },
      onError: (err) => toast.error(err.message || "Could not submit request"),
    }),
  );

  if (!isCastMember) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            className="w-fit gap-1.5 bg-yellow-400 font-semibold text-black hover:bg-yellow-300 [--btn-3d:var(--color-amber-600)]"
          >
            <FlagIcon className="size-4" />
            Report or request removal
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request removal or correction</DialogTitle>
          <DialogDescription>
            {entityName ? `For “${entityName}”. ` : ""}As a verified cast member, you can flag this
            content for our team to review. Nothing changes until we do.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label>What should we look at?</Label>
            <Select value={scope} onValueChange={(v) => v && setScope(v as Scope)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => v && setReason(v as Reason)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="removal-note">Anything else? (optional)</Label>
            <Textarea
              id="removal-note"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add any detail that will help us review this."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={submit.isPending}
            onClick={() =>
              submit.mutate({ entityType, entityId, scope, reason, note: note.trim() || undefined })
            }
          >
            {submit.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
