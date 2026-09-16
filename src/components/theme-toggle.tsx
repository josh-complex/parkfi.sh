import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "#/components/ui/button.tsx";

/**
 * Site-header theme key. Sized and shaped to the header's other controls — the
 * 44px outline key with the search palette's 18px radius — so the actions
 * cluster reads as one set rather than a ghost icon between two buttons.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className="size-11 rounded-[18px] text-muted-foreground [&_svg:not([class*='size-'])]:size-5"
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}
