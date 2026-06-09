"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, X } from "lucide-react";

import { Button } from "#/components/ui/button";
import { usePushNotifications } from "#/hooks/use-push-notifications.ts";
import { cn } from "#/lib/utils.ts";

const DISMISS_KEY = "parkfi:notif-prompt-dismissed";

/**
 * A one-shot invitation to turn on push alerts. It surfaces only when the
 * browser supports push, permission hasn't been decided yet, and the user
 * hasn't already dismissed it — so we ask once, in-context, rather than firing
 * a cold permission dialog on load.
 */
export function NotificationPrompt({ className }: { className?: string }) {
  const { supported, permission, subscribe, pending } = usePushNotifications();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — just hide for the session */
    }
    setDismissed(true);
  }

  async function enable() {
    const ok = await subscribe();
    if (ok) dismiss();
  }

  const visible = supported && permission === "default" && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn("overflow-hidden", className)}
        >
          <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#1c468e] p-4 text-white shadow-lg ring-1 ring-white/10">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
              <BellRing className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Never miss a short line</p>
              <p className="text-xs text-blue-100/90">
                Get a push the moment a ride&apos;s wait drops to your target.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => void enable()}
              disabled={pending}
              className="shrink-0 bg-white text-primary hover:bg-white/90"
            >
              Enable
            </Button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute right-2 top-2 rounded-full p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
