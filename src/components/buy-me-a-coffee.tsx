import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

import type { CSSProperties, FC } from "react";

const COFFEE_URL = "https://www.buymeacoffee.com/parkfish";
// BMC's official branded button asset (the "non-api" one). `default-yellow`
// matches the `#ffd500` color from the BMC embed config.
const BADGE_SRC = "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png";

/**
 * Support link to Buy Me a Coffee: the official BMC badge image, wrapped in our
 * `Button` so it inherits the app's border + 3D shadow. Lives in the desktop
 * blue toolbar; mobile drops the support link entirely.
 */
export const BuyMeACoffee: FC<{ className?: string; style?: CSSProperties }> = ({
  className,
  style,
}) => {
  const anchor = <a href={COFFEE_URL} target="_blank" rel="noopener noreferrer" />;

  return (
    <Button
      render={anchor}
      aria-label="Buy me a coffee"
      style={style}
      className={cn(
        "shrink-0 overflow-hidden border-amber-500/60 bg-amber-400 p-0 hover:bg-amber-300 [--btn-3d:var(--color-amber-600)]",
        className,
      )}
    >
      <img src={BADGE_SRC} alt="Buy me a coffee" className="h-full w-auto" />
    </Button>
  );
};
