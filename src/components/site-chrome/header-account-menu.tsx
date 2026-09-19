import { Link, useNavigate } from "@tanstack/react-router";
import {
  FileTextIcon,
  FootprintsIcon,
  LogInIcon,
  LogOutIcon,
  SettingsIcon,
  TrophyIcon,
  WrenchIcon,
} from "lucide-react";

import { LevelBadge, LevelDetails } from "#/components/achievements/level-badge.tsx";
import { LoginLink } from "#/components/login-link.tsx";
import { useIsAdmin } from "#/components/maintenance-gate.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useUserLevel } from "#/hooks/use-level.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";
import { signOut } from "#/lib/sign-out.ts";

/** Initials fallback for a user with no avatar image. */
function initialsFor(user: { name?: string | null; email: string }) {
  return user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : (user.email[0] ?? "U").toUpperCase();
}

/**
 * The desktop header's account control: an avatar that opens the account menu.
 * Successor to the sidebar footer's `NavUser` (docs/plans/dining-redesign §5.2).
 * It also carries the two *personal* destinations that used to sit in the
 * sidebar's primary nav — Activity and Badges — plus the admin-only Filings
 * feed, which keeps them off the public nav row without losing them.
 *
 * Aligned `align="end"` because it hangs off the header's right edge; the
 * sidebar version opened to the `right` of a left-hand rail.
 */
export function HeaderAccountMenu() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const userLevel = useUserLevel();
  const isAdmin = useIsAdmin();

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/login" });
  };

  // Every control in the header's actions cluster is a 44px key with the search
  // palette's 18px radius; the avatar and the signed-out key match it.
  if (isPending) return <Skeleton className="size-11 shrink-0 rounded-[18px]" />;

  if (!session?.user) {
    return (
      <Button
        variant="outline"
        className="h-11 shrink-0 rounded-[18px] px-4"
        render={<LoginLink />}
      >
        <LogInIcon />
        Sign in
      </Button>
    );
  }

  const user = session.user;
  const initials = initialsFor(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            // The same 44px outline key as the bell, the search and the theme
            // toggle — rim, shelf and press, not a bare image. A shelf-less
            // avatar also sat *low* in the `items-center` row: its neighbours
            // are 44px of face plus a 3px ledge, so centring the box put their
            // faces higher than a plain 44px circle's.
            className={cn(
              buttonVariants({ variant: "outline", size: "icon" }),
              "size-11 overflow-hidden rounded-[18px] p-0",
            )}
          />
        }
      >
        {/* Fills the key's content box, and drops the avatar's own hairline
            ring — the button's rim is already drawing that edge, and the
            avatar's is a circle that would cut across the squircle.

            Square, and clipped by the key rather than rounded to match it.
            `rounded-[inherit]` looked like the careful answer and is the wrong
            one: `inherit` takes the key's *outer* 18px radius and applies it to
            a box that is the key minus its 1px rim, which curves harder than
            the hole it sits in and leaves a wedge of the button's own face
            showing at each corner. The key is already `overflow-hidden`, and
            clipping happens at the padding box — exactly the shape we want the
            image to take — so the correct radius here is none at all. */}
        <Avatar className="size-full rounded-none after:hidden">
          <AvatarImage
            src={user.image ?? undefined}
            alt={user.name ?? user.email}
            className="rounded-none"
          />
          <AvatarFallback className="rounded-none bg-transparent text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="end" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar className="size-8">
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name ?? user.email}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              {userLevel && <LevelBadge level={userLevel.level.level} />}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {userLevel && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <LevelDetails level={userLevel.level} />
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/activity" />}>
          <FootprintsIcon />
          Activity
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/achievements" />}>
          <TrophyIcon />
          Badges
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/account" />}>
          <SettingsIcon />
          Account settings
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/filings" />}>
              <FileTextIcon />
              Filings
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/admin" />}>
              <WrenchIcon />
              Admin
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleSignOut()}>
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
