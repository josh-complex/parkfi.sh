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
import { Button } from "#/components/ui/button.tsx";
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
            className="relative shrink-0 rounded-[18px] ring-offset-background transition-transform outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95"
          />
        }
      >
        <Avatar className="size-11 rounded-[18px]">
          <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
          <AvatarFallback className="rounded-[18px] text-xs">{initials}</AvatarFallback>
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
