import { CheckIcon, MinusIcon, ShieldAlertIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";

/**
 * Shown when a Microsoft/Disney sign-in is blocked before it ever reaches our
 * callback — almost always because the cast member's Entra tenant hasn't
 * approved ParkFi (admin-consent required), or they declined the consent screen.
 *
 * Rather than a dead-end error, we restate what happened and reframe the choice:
 * they can still sign up as a regular guest and keep almost everything, losing
 * only the cast-member moderation tools. See `login.tsx` for where this opens.
 */

/** What a regular guest account keeps — the reassuring column. */
const KEEP: Array<string> = [
  "Personalize your dashboard and save favorite parks",
  "Ride wait-time and dining reservation alerts",
  "Achievements, XP, and levels",
  "Build and trade your pin collection",
];

/** Cast-member-only tools that require the verified role. */
const LOSE: Array<string> = [
  "Submit content removal & correction requests",
  "Flag inaccurate photos or menus for our team to suppress",
  "Track the status of requests you've filed",
  "Your Cast Member badge",
];

export function CastMemberBlockedDialog({
  open,
  onOpenChange,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The mapped, human-readable reason the sign-in was blocked. */
  description: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
            <ShieldAlertIcon className="size-5" />
          </div>
          <DialogTitle className="mt-1">Cast Member sign-in needs approval</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold text-foreground">
              You can still sign up as a guest
            </p>
            <ul className="mt-2.5 flex flex-col gap-2">
              {KEEP.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">
              Cast Member tools you won't have
            </p>
            <ul className="mt-2.5 flex flex-col gap-2">
              {LOSE.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MinusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Once your organization approves ParkFi, sign in with your Disney account again and your
          Cast Member tools unlock automatically.
        </p>

        <p className="rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Note for IT admins:</span> we strongly
          recommend scoping access rather than granting it to every Cast Member. These tools can
          moderate and suppress public content, so approval is best limited to a designated group.
        </p>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Continue as a guest</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
