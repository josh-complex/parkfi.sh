import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "#/components/ui/button.tsx";
import { SidebarMenuButton } from "#/components/ui/sidebar.tsx";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}

export function SidebarThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <SidebarMenuButton tooltip="Toggle theme" onClick={toggle}>
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
      <span>Toggle theme</span>
    </SidebarMenuButton>
  );
}
