import * as React from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, FerrisWheelIcon, TicketIcon, UtensilsIcon } from "lucide-react";

import { NavUser } from "#/components/nav-user.tsx";
import { SidebarThemeToggle } from "#/components/theme-toggle.tsx";
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
  const { pathname, locationSearch } = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, locationSearch: s.location.search }),
  });

  const isLiveBoard = pathname === "/";
  const activeParkSlug = isLiveBoard
    ? ((locationSearch as { park?: string }).park ?? undefined)
    : undefined;

  const trpc = useTRPC();
  const parksQ = useQuery({ ...trpc.parks.list.queryOptions(), enabled: isLiveBoard });
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

  const effectiveSlug = activeParkSlug ?? parks?.[0]?.slug;

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
                    isActive={item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)}
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

        {isLiveBoard && byResort.length > 0 && (
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
                          onClick={() => void navigate({ to: "/", search: { park: park.slug } })}
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
