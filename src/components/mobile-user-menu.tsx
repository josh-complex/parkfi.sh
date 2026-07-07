import { Link, useNavigate } from "@tanstack/react-router";
import {
  BellIcon,
  LogInIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  ShapesIcon,
  SunIcon,
  TrendingUpIcon,
  TrophyIcon,
  UserRoundIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { LevelBadge, LevelDetails } from "#/components/achievements/level-badge.tsx";
import { CastAvatarBadge } from "#/components/cast-member-badge.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { useUserLevel } from "#/hooks/use-level.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Mobile top-bar account menu — a bottom sheet (vaul Drawer), not a Base UI
 * popover-menu. Base UI's Menu does a synchronous `flushSync` on open whose
 * commit collides with the imperatively-teleported map host on `/map` ("removeChild
 * of null"); the Drawer (same primitive the search uses here) doesn't. Together
 * with the bottom nav island it keeps the app navigable without the old hamburger:
 * Pins, Forecast, notifications, theme, account, and auth are all one tap away.
 */
const ROW =
  "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

export function MobileUserMenu({ showDot = false }: { showDot?: boolean }) {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const userLevel = useUserLevel();
  const user = session?.user;

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : (user?.email[0] ?? "U").toUpperCase();

  const handleSignOut = async () => {
    await authClient.signOut();
    await navigate({ to: "/login" });
  };

  return (
    <Drawer>
      <DrawerTrigger
        aria-label="Account menu"
        className="border-3d btn-3d-outline shadow-3d relative top-0 inline-flex size-13 shrink-0 self-center items-center justify-center rounded-full bg-background text-foreground transition-[top,box-shadow] duration-150 active:top-[3px] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)]"
      >
        {user?.image ? (
          <img
            src={user.image}
            alt={user.name ?? user.email}
            className="size-full rounded-full object-cover"
          />
        ) : user ? (
          <span className="text-sm font-semibold">{initials}</span>
        ) : (
          <UserRoundIcon className="size-5" />
        )}
        {showDot && (
          <span className="bg-primary absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-background" />
        )}
        {user && userLevel && (
          <LevelBadge
            level={userLevel.level.level}
            size="sm"
            className="absolute -top-1 -right-1 ring-2 ring-background"
          />
        )}
        <CastAvatarBadge />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4">
          {user ? (
            <>
              <div className="flex items-center gap-3 text-left">
                <span className="border-3d shadow-3d inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold dark:border-[color-mix(in_oklch,var(--border),white_25%)]">
                  {user.image ? (
                    <img
                      src={user.image}
                      alt={user.name ?? user.email}
                      className="size-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </span>
                <div className="grid min-w-0 flex-1">
                  <DrawerTitle className="truncate text-base">
                    {user.name ?? user.email}
                  </DrawerTitle>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
              {userLevel && <LevelDetails level={userLevel.level} className="mt-3" />}
            </>
          ) : (
            <DrawerTitle>Account</DrawerTitle>
          )}
        </DrawerHeader>

        <div className="flex flex-col gap-0.5 p-2">
          <DrawerClose asChild>
            <Link to="/pins" className={ROW}>
              <ShapesIcon />
              Pins
            </Link>
          </DrawerClose>
          <DrawerClose asChild>
            <Link to="/predictions" className={ROW}>
              <TrendingUpIcon />
              Forecast
            </Link>
          </DrawerClose>
          <DrawerClose asChild>
            <Link to="/achievements" className={ROW}>
              <TrophyIcon />
              Badges
            </Link>
          </DrawerClose>
          <DrawerClose asChild>
            <Link to="/alerts" className={ROW}>
              <BellIcon />
              Notifications
              {showDot && <span className="bg-primary ml-auto size-2 rounded-full" />}
            </Link>
          </DrawerClose>
          <button
            type="button"
            className={ROW}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </button>

          <div className="my-1 h-px bg-border/60" />

          {user ? (
            <>
              <DrawerClose asChild>
                <Link to="/account" className={ROW}>
                  <SettingsIcon />
                  Account settings
                </Link>
              </DrawerClose>
              <DrawerClose asChild>
                <button
                  type="button"
                  className={cn(ROW, "text-destructive [&>svg]:text-destructive")}
                  onClick={() => void handleSignOut()}
                >
                  <LogOutIcon />
                  Log out
                </button>
              </DrawerClose>
            </>
          ) : (
            <DrawerClose asChild>
              <Link to="/login" className={ROW}>
                <LogInIcon />
                Sign in
              </Link>
            </DrawerClose>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
