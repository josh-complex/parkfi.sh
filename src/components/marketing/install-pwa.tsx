"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";

/** The `beforeinstallprompt` event isn't in the DOM lib's type map. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install the app" CTA for the PWA. Renders nothing until the browser fires
 * `beforeinstallprompt` — i.e. the app is installable and not already installed —
 * so it's a clean no-op on iOS Safari, in an already-installed window, or any
 * non-installable context. Clicking it triggers the native install prompt.
 */
export function InstallPwaButton({ className }: { className?: string }) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!installEvent) return null;

  return (
    <Button
      size="lg"
      className={className}
      onClick={() => {
        void installEvent.prompt();
        setInstallEvent(null);
      }}
    >
      <DownloadIcon className="size-4" aria-hidden />
      Install the app
    </Button>
  );
}
