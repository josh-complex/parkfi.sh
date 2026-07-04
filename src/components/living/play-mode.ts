import { Store } from "@tanstack/store";

/**
 * Play mode ("Kingdom Hearts") is an OVERLAY on the shared free-roam map, not a
 * separate screen. This tiny store carries the on/off toggle so the mobile
 * bottom nav's Play button (which turns it on) and the map stage (which renders
 * the game layer) can share one piece of state from anywhere in the tree —
 * including the `AppInset` pages outside `_dash` that render the bottom nav.
 * Client-only UI state: the server never writes it, so the module-level store
 * always serializes its `false` defaults during SSR.
 */
interface PlayModeState {
  playMode: boolean;
  /** True while a bottom-center HUD panel (battle / discovery drop) is open, so
   *  the bottom-nav Play button can fade out and hand it the bottom band. */
  hudExpanded: boolean;
}

export const playModeStore = new Store<PlayModeState>({
  playMode: false,
  hudExpanded: false,
});

export function setPlayMode(playMode: boolean) {
  playModeStore.setState((s) => ({ ...s, playMode }));
}

export function setHudExpanded(hudExpanded: boolean) {
  playModeStore.setState((s) => (s.hudExpanded === hudExpanded ? s : { ...s, hudExpanded }));
}
