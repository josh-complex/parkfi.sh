import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ActivityIcon, FerrisWheelIcon, TicketIcon, UtensilsIcon } from "lucide-react";

import { NavUser } from "#/components/nav-user.tsx";
import { SidebarThemeToggle } from "#/components/theme-toggle.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";

const NAV: Array<{ title: string; to: string; icon: React.ReactNode }> = [
  { title: "Live Board", to: "/", icon: <ActivityIcon /> },
  { title: "Ticket Pricing", to: "/tickets", icon: <TicketIcon /> },
  { title: "Dining", to: "/dining", icon: <UtensilsIcon /> },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
