import * as React from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  FerrisWheelIcon,
  ShieldAlertIcon,
  TicketIcon,
  UtensilsIcon,
} from "lucide-react";

import { NavUser } from "#/components/nav-user.tsx";
import { SidebarThemeToggle } from "#/components/theme-toggle.tsx";
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
} from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

const NAV: Array<{ title: string; to: string; icon: React.ReactNode }> = [
  { title: "Live Board", to: "/", icon: <ActivityIcon /> },
  { title: "Ticket Pricing", to: "/tickets", icon: <TicketIcon /> },
  { title: "Dining", to: "/dining", icon: <UtensilsIcon /> },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false }) as { slug?: string };

  // The dashboard (overview + per-park) shares one shell, so the park list shows
  // on both `/` and `/park/*`.
  const isDashboard = pathname === "/" || pathname.startsWith("/park");
  const activeParkSlug = params.slug;

  const trpc = useTRPC();
  const parksQ = useQuery({ ...trpc.parks.list.queryOptions(), enabled: isDashboard });
  const parks = parksQ.data;

  const navigate = useNavigate();

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
              render={<Link to="/" />}
            >
              <FerrisWheelIcon className="size-5!" />
              <span className="text-base font-semibold">parkfi.sh</span>
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
                          onClick={() =>
                            void navigate({ to: "/park/$slug", params: { slug: park.slug } })
                          }
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
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between px-2">
          <Button variant="ghost" size="sm" render={<Link to="/disclaimers" />}>
            <ShieldAlertIcon />
            Disclaimers
          </Button>
          <SidebarThemeToggle />
        </div>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
