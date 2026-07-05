"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { XIcon } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { MenuBody, useMenuState } from "#/components/dining/menu-content.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { cn } from "#/lib/utils.ts";

// ── Desktop dialog (motion-powered) ───────────────────────────────────────────

const LAYOUT_ID_PREFIX = "menu-popup-";

function DesktopMenuDialog({ facilityId, name }: { facilityId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const layoutId = `${LAYOUT_ID_PREFIX}${facilityId}`;

  const state = useMenuState(facilityId, open);

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/*
       * The trigger button stays mounted and uses the same layoutId as the dialog
       * popup. When the dialog opens, the trigger fades out; motion's layoutId
       * animates the popup from the trigger's last known position/size.
       * When the dialog closes, the popup exits and the trigger fades back in.
       */}
      <motion.button
        layoutId={layoutId}
        type="button"
        onClick={() => setOpen(true)}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{
          layout: { type: "spring", stiffness: 580, damping: 40, mass: 0.75 },
          opacity: { duration: open ? 0.05 : 0.1, delay: open ? 0 : 0.22 },
        }}
        style={{ borderRadius: 24 }}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
        aria-label={`View menu for ${name}`}
      >
        Menu
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              {/* Backdrop */}
              <motion.div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.14 } }}
                exit={{ opacity: 0, transition: { duration: 0.07 } }}
                onClick={() => setOpen(false)}
              />

              {/* Dialog popup — shares layoutId with the trigger button */}
              <motion.div
                layoutId={layoutId}
                role="dialog"
                aria-modal="true"
                aria-label={name}
                style={{ borderRadius: 24 }}
                transition={{ layout: { type: "spring", stiffness: 400, damping: 30, mass: 0.9 } }}
                className="relative z-10 flex max-h-full w-full max-w-4xl flex-col overflow-hidden bg-popover border-3d btn-3d-outline shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:border-border dark:ring-1 dark:ring-foreground/10"
              >
                {/* Content wrapper — fades in after the spring settles on open,
                    fades out immediately so the container morphs back clean. */}
                <motion.div
                  className="flex min-h-0 flex-1 flex-col"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.21, duration: 0.1 } }}
                  exit={{ opacity: 0, transition: { duration: 0.05 } }}
                >
                  {/* Compact header */}
                  <div className="flex shrink-0 items-center justify-between gap-4 px-6 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        Prices excl. tax &amp; gratuity
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 bg-secondary"
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </div>

                  <MenuBody
                    periods={state.periods}
                    activePeriodIdx={state.activePeriodIdx}
                    onSwitchPeriod={state.switchPeriod}
                    typeSections={state.typeSections}
                    onJumpToType={state.jumpToType}
                    sectionRefs={state.sectionRefs}
                    scrollRef={state.scrollRef}
                    pillsRef={state.pillsRef}
                    twoColumn
                    menuIsLoading={state.menuQ.isLoading}
                    changesBySlug={state.changesBySlug}
                  />
                </motion.div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ── Mobile drawer ──────────────────────────────────────────────────────────────

function MobileMenuDrawer({ facilityId, name }: { facilityId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const state = useMenuState(facilityId, open);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          Menu
        </Button>
      </DrawerTrigger>
      <DrawerContent className="flex max-h-[90vh] flex-col">
        <DrawerHeader className="shrink-0 pb-3 text-left">
          <DrawerTitle>{name}</DrawerTitle>
        </DrawerHeader>
        <MenuBody
          periods={state.periods}
          activePeriodIdx={state.activePeriodIdx}
          onSwitchPeriod={state.switchPeriod}
          typeSections={state.typeSections}
          onJumpToType={state.jumpToType}
          sectionRefs={state.sectionRefs}
          scrollRef={state.scrollRef}
          pillsRef={state.pillsRef}
          twoColumn={false}
          menuIsLoading={state.menuQ.isLoading}
          changesBySlug={state.changesBySlug}
        />
      </DrawerContent>
    </Drawer>
  );
}

// ── Public export ──────────────────────────────────────────────────────────────

/**
 * Renders a "View menu" button that:
 *  - On desktop: morphs into a full dialog via motion's `layoutId` shared-layout
 *    animation. Sections are displayed in two columns with a vertical divider.
 *  - On mobile: opens a bottom Drawer with single-column sections.
 *
 * The menu rendering itself is shared with the standalone venue page via
 * `menu-content.tsx` (`MenuBody` + `useMenuState`).
 */
export function DiningMenuDrawer({ facilityId, name }: { facilityId: string; name: string }) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileMenuDrawer facilityId={facilityId} name={name} />
  ) : (
    <DesktopMenuDialog facilityId={facilityId} name={name} />
  );
}
