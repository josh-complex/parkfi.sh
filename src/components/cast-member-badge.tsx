import { SparklesIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

/** True when the signed-in user is a verified park cast member. */
export function useIsCastMember(): boolean {
  const { data: session } = authClient.useSession();
  return session?.user?.role === "cast_member";
}

/**
 * Desktop-toolbar headline shown only to verified cast members — a warm greeting
 * that sits in the blue app toolbar between the search and the support link.
 * Renders nothing for everyone else.
 */
export function CastMemberHeadline({ className }: { className?: string }) {
  const { data: session } = authClient.useSession();
  if (session?.user?.role !== "cast_member") return null;
  const firstName = session.user.name?.trim().split(/\s+/)[0];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur",
        className,
      )}
    >
      <SparklesIcon className="size-3.5 shrink-0" />
      <span className="whitespace-nowrap">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"} · Cast Member
      </span>
    </div>
  );
}

/**
 * Absolute "Cast" pill pinned to the bottom of the mobile account avatar. Meant
 * to be dropped inside the avatar's `relative` trigger; renders nothing unless
 * the signed-in user is a cast member.
 */
export function CastAvatarBadge() {
  const { data: session } = authClient.useSession();
  if (session?.user?.role !== "cast_member") return null;

  return (
    <span className="pointer-events-none absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-1.5 py-px text-[9px] font-bold uppercase leading-none tracking-wide text-primary-foreground ring-2 ring-background">
      Cast
    </span>
  );
}
