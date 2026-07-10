import { Link, useNavigate } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon, SettingsIcon, TrophyIcon } from "lucide-react";
import { authClient } from "#/lib/auth-client.ts";
import { signOut } from "#/lib/sign-out.ts";
import { LevelBadge, LevelDetails } from "#/components/achievements/level-badge.tsx";
import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
import { SidebarThemeToggle } from "#/components/theme-toggle.tsx";
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
import { SidebarMenu, SidebarMenuItem, useSidebar } from "#/components/ui/sidebar.tsx";
import { useUserLevel } from "#/hooks/use-level.ts";

export function NavUser() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const { isMobile } = useSidebar();
  const userLevel = useUserLevel();
  // The bell + theme toggle live beside the user button only on mobile (in the
  // offcanvas menu). On desktop they've moved to the blue toolbar (see AppInset),
  // so the footer no longer carries them at any panel state.
  const showActions = isMobile;

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/login" });
  };

  if (isPending) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <Skeleton className="h-12 w-full rounded-xl" />
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (!session?.user) {
    return (
      <div className="flex items-center justify-between gap-1 px-2">
        <Button variant="ghost" size="sm" render={<Link to="/login" />}>
          <LogInIcon />
          Sign in
        </Button>
        {/* Mobile: theme + notifications moved out of the header into the menu, so
            keep them reachable even when signed out. */}
        {isMobile && (
          <div className="flex items-center gap-1">
            <NotificationCenter />
            <SidebarThemeToggle />
          </div>
        )}
      </div>
    );
  }

  const user = session.user;
  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : (user.email[0] ?? "U").toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="h-auto flex-1 justify-start gap-2 rounded-xl border-white/15 bg-transparent px-3 py-2 text-white hover:bg-white! hover:text-foreground! aria-expanded:bg-white/15! aria-expanded:text-white! aria-expanded:hover:bg-white/15! aria-expanded:hover:text-white! btn-3d-invert border-3d"
              />
            }
          >
            <Avatar className="size-7 shrink-0 rounded-lg">
              <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
              <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate text-left text-sm font-medium">
              {user.name ?? user.email}
            </span>
            {userLevel && <LevelBadge level={userLevel.level.level} />}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
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
            <DropdownMenuItem render={<Link to="/achievements" />}>
              <TrophyIcon />
              Badges
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/account" />}>
              <SettingsIcon />
              Account settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleSignOut()}>
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {showActions && <NotificationCenter />}
        {showActions && <SidebarThemeToggle />}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
