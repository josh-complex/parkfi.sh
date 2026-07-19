# Reading the device display corner radius — Android / iOS / PWA

_Research, 2026-07-18. Question: can we read the physical screen's rounded-corner
radius on each platform we ship (Capacitor Android, Capacitor iOS, PWA/web), so
UI drawn near the screen edges (nav panel, map controls, banners) can be
concentric with the bezel instead of using a guessed radius?_

## TL;DR

| Platform               | Readable?                  | How                                                                                        | Confidence                         |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| Android (native shell) | **Yes, public API**        | `WindowInsets.getRoundedCorner()` on API 31+ (Android 12)                                  | High on 12+; best-effort below     |
| iOS (native shell)     | **Yes, but no public API** | Private `UIScreen._displayCornerRadius` (store risk) **or** static device-DB lookup (safe) | High either way; trade-offs differ |
| PWA / web              | **No**                     | Nothing shipped in any browser; CSSWG proposal open since 2021                             | Heuristics only                    |

The practical shape of a solution for us: a tiny local Capacitor plugin that
resolves the radius natively and injects it as a CSS variable
(`--device-corner-radius`), exactly mirroring how the bundled SystemBars plugin
already injects `--safe-area-inset-*` (see `capacitor.config.ts` and the
`--safe-*` cascade in `src/styles.css:63`). Web falls back to a default.

---

## Android

**Android 12+ (API 31): fully supported, public, per-corner.**
`WindowInsets.getRoundedCorner(position)` returns a
[`RoundedCorner`](https://developer.android.com/reference/android/view/RoundedCorner)
with the radius **and** center point, for each of the four positions
(`POSITION_TOP_LEFT` … `POSITION_BOTTOM_LEFT`). Official guidance:
[Insets: apply rounded corners](https://developer.android.com/develop/ui/views/layout/insets/rounded-corners).

Details that matter for implementation:

- Values are **relative to the app window**, not the display. It returns `null`
  for a corner that isn't inside the app's bounds (e.g. multi-window). Our
  Capacitor WebView is fullscreen edge-to-edge (SDK 35+ mandatory
  edge-to-edge), so in practice all four corners resolve.
- Radius is in **physical px** — divide by `resources.displayMetrics.density`
  before handing to CSS.
- Read it from `view.rootWindowInsets` once the view is attached, or in
  `onApplyWindowInsets`. Values don't change at runtime for a given device
  except across window-bounds changes (fold/unfold, multi-window), so a
  read-at-startup + listener-on-inset-change is enough.

**API 24–30 (our `minSdkVersion` is 24, `android/variables.gradle`):** no public
API. The framework's own value exists as the internal dimen resource
`rounded_corner_radius` (what SystemUI uses to draw the corner overlay),
readable via
`Resources.getSystem().getIdentifier("rounded_corner_radius", "dimen", "android")`.
It's OEM-populated — present and correct on Pixels and most Samsungs, `0` or
missing on others. Fine as best-effort with a `0` (square) fallback; not worth
more engineering, since Android 12 is now ~4.5 years old and dominates our
plausible install base.

## iOS

**There is still no public read API, through iOS 26.** Three routes exist:

1. **Private API:** `UIScreen` responds to the private KVC key
   `_displayCornerRadius`. It's exact and future-proof (comes from the OS, so
   new devices are automatically right). Every library in this space
   ([ScreenCorners](https://github.com/kylebshr/ScreenCorners),
   [react-native-screen-corner-radius](https://github.com/mrousavy/react-native-screen-corner-radius))
   uses it with an obfuscated key string to slip past App Store static
   analysis. It routinely passes review, but it is formally grounds for
   rejection, and the risk compounds per submission
   ([BezelKit's motivation writeup](https://markbattistella.com/writings/2023/introducing-bezelkit/)).
   **For us this is the wrong moment:** the Capacitor initiative is heading
   into first store submission; a private-API flag on the very first review
   would be an unforced error.

2. **Static device database:** map the device model identifier
   (`utsname.machine`, e.g. `iPhone17,1`) to a known radius.
   [BezelKit](https://markbattistella.com/writings/2023/introducing-bezelkit/)
   maintains exactly this as a JSON DB with no private API use. Known values
   span ~39pt (iPhone X) to ~62pt (recent Pros); an unknown-future-device
   fallback of ~55–60pt is visually indistinguishable. Cost: one small lookup
   table (or the BezelKit pod) and a once-a-year update when new hardware
   ships. We only ship iPhone-class UI, so the table is ~25 entries.

3. **iOS 26 concentric APIs — not a read path.** iOS 26 added
   [`ConcentricRectangle`](https://developer.apple.com/documentation/swiftui/concentricrectangle),
   `.containerConcentric`, and `UICornerConfiguration`, which _draw_ shapes
   concentric with the display corner — but they never expose the numeric
   radius, and they only work for native SwiftUI/UIKit views, not content
   inside a WebView ([details](https://nilcoalescing.com/blog/ConcentricRectangleInSwiftUI/),
   [dev-forums thread confirming no read access](https://developer.apple.com/forums/thread/794685)).
   Useless for us: our UI is in the WebView.

**Recommendation: route 2** (static lookup), with route 1 optionally revisited
after we're established in the store.

## PWA / web

**No browser exposes it.** The state of the art:

- CSS environment variables only cover `safe-area-inset-*` (and the newer
  `safe-area-max-inset-*`) — insets, not curvature. The CSSWG proposal to add
  corner-radius env vars is
  [csswg-drafts #6259](https://github.com/w3c/csswg-drafts/issues/6259), open
  since 2021 with no implementation in any engine.
- Chrome's new `corner-shape` property is authoring-only (draw superellipse
  corners), not a sensor.
- No JS API (Screen, VisualViewport, media queries) carries it either.

Heuristic options, in descending usefulness:

- **iOS standalone PWA:** the UA is frozen and carries no model, but
  `screen.width/height` + `devicePixelRatio` maps to a small set of iPhone
  logical-resolution classes. Models sharing a resolution class have near-equal
  radii, so a dims→radius table gets within a few px. This is what web apps
  that care actually do.
- **Android web:** hopeless — thousands of devices, no mapping. Assume a
  default.
- **Design-side dodge:** keep edge-hugging web UI inside
  `max(var(--safe-*), 16px)`-ish padding so the exact radius never matters in
  the browser/PWA case. This is effectively what we do today.

## Proposed integration (if/when we build it)

> **Status: implemented 2026-07-19.** Local `DeviceCorners` plugin
> (`android/.../DeviceCornersPlugin.java`, `ios/.../DeviceCornersPlugin.swift`,
> registered in `MainActivity` / `ParkFiViewController`), web bridge in
> `src/lib/device-corners.ts` (called from `__root.tsx`). One deviation from the
> sketch below: per-bottom-corner CSS vars (`--device-corner-radius-{bl,br}`)
> instead of a single max, since only the bottom nav consumes them; the nav's
> outer corners use `--nav-corner-{bl,br}` =
> `clamp(1rem, device − 1rem inset, 2.5rem)` in `styles.css`.

1. **CSS contract:** add `--device-corner-radius` (single value = max of the
   four corners; per-corner only if a real design need appears) next to the
   `--safe-*` block in `src/styles.css`, defaulting to a web fallback
   (`0px`, or the iOS-PWA heuristic value if we bother).
2. **Local Capacitor plugin** (`DeviceCorners`, ~150 LOC total; we have no
   custom local plugins yet, so this also establishes that pattern):
   - Android: `getRoundedCorner` on 31+, internal dimen fallback on 24–30,
     px→dp conversion, resolve on first inset pass.
   - iOS: model-identifier lookup table, ~55pt unknown-device fallback.
   - Both return points/dp; the web layer writes the CSS var once at startup
     (radius is static per device — no listener needed beyond the initial
     inset callback on Android).
3. **Web/PWA:** no plugin; the CSS default applies.

## Sources

- [Android: Insets — apply rounded corners](https://developer.android.com/develop/ui/views/layout/insets/rounded-corners)
- [Android `RoundedCorner` reference](https://developer.android.com/reference/android/view/RoundedCorner)
- [Exploring Android 12: Rounded Corner API](https://yggr.medium.com/exploring-android-12-rounded-corner-api-a09ae1e8c528)
- [ScreenCorners (iOS private-API package)](https://github.com/kylebshr/ScreenCorners)
- [Finding the real iPhone X corner radius](https://kylebashour.com/posts/finding-the-real-iphone-x-corner-radius)
- [BezelKit — device-DB approach rationale](https://markbattistella.com/writings/2023/introducing-bezelkit/)
- [Apple dev forums: no public read even with iOS 26 concentric APIs](https://developer.apple.com/forums/thread/794685)
- [`ConcentricRectangle` docs](https://developer.apple.com/documentation/swiftui/concentricrectangle) / [analysis](https://nilcoalescing.com/blog/ConcentricRectangleInSwiftUI/)
- [CSSWG issue #6259 — env() border radius proposal](https://github.com/w3c/csswg-drafts/issues/6259)
- [CSS `env()` on MDN (current variable set)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [react-native-screen-corner-radius](https://github.com/mrousavy/react-native-screen-corner-radius) (reference implementation for both platforms)
