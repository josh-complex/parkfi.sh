import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Site-header theme key. Sized and shaped to the header's other controls — the
 * 44px outline key with the search palette's 18px radius — so the actions
 * cluster reads as one set rather than a ghost icon between two buttons.
 */
export function ThemeToggle({ className }: { className?: string } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className={cn(
        "size-11 rounded-[18px] text-muted-foreground [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
    >
      {/* Keyed to the document's own class (next-themes writes it on <html>),
          not to the `dark:` variant. The variant asks "is there a `.dark`
          anywhere above me", and the floating nav answers yes to that while
          the *page* is still light — it flips the tokens on its own subtree so
          the chrome can sit on a dark field. This key is the one control in
          there that must report the real theme, not the local one: it was
          offering the moon on a light page. */}
      <SunIcon className="[html.dark_&]:hidden" />
      <MoonIcon className="hidden [html.dark_&]:block" />
    </Button>
  );
}
