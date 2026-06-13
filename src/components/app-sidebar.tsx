import * as React from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  BedDoubleIcon,
  ShieldAlertIcon,
  TicketIcon,
  TrendingUpIcon,
  UtensilsIcon,
} from "lucide-react";

import { NavUser } from "#/components/nav-user.tsx";
import { ConstructionIcon } from "#/components/ui/anim-icons/construction.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

const NAV: Array<{ title: string; to: string; icon: React.ReactNode }> = [
  { title: "Waits", to: "/", icon: <ActivityIcon /> },
  { title: "Tickets", to: "/tickets", icon: <TicketIcon /> },
  { title: "Eats", to: "/dining", icon: <UtensilsIcon /> },
  { title: "Stays", to: "/stays", icon: <BedDoubleIcon /> },
  { title: "Forecast", to: "/predictions", icon: <TrendingUpIcon /> },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false }) as { slug?: string };

  // The dashboard (overview + per-park) shares one shell, so the park list shows
  // on both `/` and `/park/*`.
  const isDashboard = pathname === "/" || pathname.startsWith("/park");
  const activeParkSlug = params.slug;

  // Stays lists the bookable operators; the park/area scope lives in the
  // board's search bar rather than the sidebar.
  const isStays = pathname.startsWith("/stays");

  const trpc = useTRPC();
  const parksQ = useQuery({ ...trpc.parks.list.queryOptions(), enabled: isDashboard });
  const parks = parksQ.data;

  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  // On mobile the sidebar is an overlay sheet, so collapse it once the user
  // picks a destination.
  const closeOnMobile = React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const byResort = React.useMemo(() => {
    if (!parks) return [];
    const map = new Map<string, typeof parks>();
    for (const p of parks) {
      const key = p.resortName ?? "Other";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return [...map.entries()].map(([resort, items]) => ({ resort, items }));
  }, [parks]);

  const effectiveSlug = activeParkSlug;

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              onClick={closeOnMobile}
              render={<Link to="/" />}
            >
              <img src="/logo512.png" alt="ParkFi" className="size-6! shrink-0 rounded-md" />
              <span className="text-base font-semibold">ParkFi</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.to === "/" ? isDashboard : pathname.startsWith(item.to)}
                    onClick={closeOnMobile}
                    render={<Link to={item.to} />}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isDashboard && byResort.length > 0 && (
          <>
            <SidebarSeparator />
            {byResort.map((group) => (
              <SidebarGroup key={group.resort}>
                <SidebarGroupLabel>{group.resort}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((park) => (
                      <SidebarMenuItem key={park.slug}>
                        <SidebarMenuButton
                          isActive={park.slug === effectiveSlug}
                          onClick={() => {
                            closeOnMobile();
                            void navigate({ to: "/park/$slug", params: { slug: park.slug } });
                          }}
                        >
                          <span>{park.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </>
        )}

        {isStays && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Operators</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive
                      onClick={() => {
                        closeOnMobile();
                        void navigate({ to: "/stays", search: {} });
                      }}
                    >
                      <span>Walt Disney World</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      aria-disabled
                      className="justify-between"
                      title="Coming soon"
                    >
                      <span>Universal Orlando</span>
                      <ConstructionIcon
                        autoplay
                        size={18}
                        className="text-muted-foreground shrink-0"
                      />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={closeOnMobile}
            render={<Link to="/disclaimers" />}
          >
            <ShieldAlertIcon />
            Disclaimers
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeOnMobile}
            render={<Link to="/disclaimers" />}
          >
            Terms & Privacy
          </Button>
        </div>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
