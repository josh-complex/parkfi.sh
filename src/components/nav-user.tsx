import { Link, useNavigate } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
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
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "#/components/ui/sidebar.tsx";
import { EllipsisVerticalIcon } from "lucide-react";

export function NavUser() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const { isMobile, state } = useSidebar();
  // The bell lives in the top bar on mobile and when the panel is collapsed
  // (the footer slides offcanvas there); when expanded on desktop it sits beside
  // the user button instead.
  const showBell = !isMobile && state === "expanded";

  const handleSignOut = async () => {
    await authClient.signOut();
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
      <div className="px-2">
        <Button variant="ghost" size="sm" render={<Link to="/login" />}>
          <LogInIcon />
          Sign in
        </Button>
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
              <SidebarMenuButton size="lg" className="flex-1 aria-expanded:bg-sidebar-accent" />
            }
          >
            <Avatar className="size-8 rounded-lg grayscale">
              <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
              <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name ?? user.email}</span>
              <span className="truncate text-xs text-sidebar-foreground/70">{user.email}</span>
            </div>
            <EllipsisVerticalIcon className="ml-auto size-4" />
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleSignOut()}>
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {showBell && <NotificationCenter />}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
