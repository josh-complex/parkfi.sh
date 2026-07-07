"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheckIcon, InfoIcon, Loader2Icon } from "lucide-react";

// Animated Lordicon status icons (public/anim, APNG). Attribution lives in the
// welcome-page footer. Sizing is in styles.css under the
// `.cn-toast[data-type="error"|"warning"]` rules.
const ERROR_ICON = "/anim/error.apng";
const WARNING_ICON = "/anim/warning.apng";

/**
 * Renders an animated APNG status icon that **replays from frame 0 every time a
 * toast mounts it**. A fresh <img> alone doesn't reliably restart a play-once
 * animated image (browsers reuse the cached, already-finished decode), so on
 * mount we clear and re-assign `src` against the prewarmed cache — that forces
 * the decoder to replay with no network round-trip.
 */
function ToastAnimIcon({ src }: { src: string }) {
  const ref = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.removeAttribute("src");
    // Reflow so the browser registers the change before we set it back.
    void el.offsetWidth;
    el.src = src;
  }, [src]);

  return <img ref={ref} src={src} alt="" aria-hidden className="select-none" />;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  // Prewarm the animated icons once at app load so the first toast plays smoothly
  // instead of decoding on the fly (the choppy first run). Warms both the HTTP
  // cache and the initial decode.
  React.useEffect(() => {
    for (const src of [ERROR_ICON, WARNING_ICON]) {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      void img.decode?.().catch(() => {
        /* prewarm is best-effort */
      });
    }
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <ToastAnimIcon src={WARNING_ICON} />,
        error: <ToastAnimIcon src={ERROR_ICON} />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // Fully rounded pill, matching the app's chip/button language.
          "--border-radius": "9999px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
