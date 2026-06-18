import { useEffect } from "react";

/**
 * Keeps the browser-tab favicon tracking the OS color scheme — white mark on a
 * dark tab bar, blue mark on a light one — the same way other sites' favicons
 * behave.
 *
 * `favicon.svg` already carries a `prefers-color-scheme` media query, but the
 * raster `rel="icon"` fallbacks (blue webp/png) declared alongside it can win in
 * Chrome's icon selection, pinning the tab to the blue mark regardless of
 * scheme. This drops the SSR-rendered icon links and manages a single PNG that
 * we swap on scheme change, so the behavior is deterministic across browsers.
 */
export function FaviconSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const href = mq.matches ? "/img/brand/white.png" : "/img/brand/blue.png";

      // Remove the competing SSR icon links (svg + raster fallbacks). The
      // `apple-touch-icon` uses a different rel, so it's left untouched.
      document
        .querySelectorAll<HTMLLinkElement>('link[rel="icon"]:not([data-app-favicon])')
        .forEach((el) => el.remove());

      let link = document.querySelector<HTMLLinkElement>("link[data-app-favicon]");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/png";
        link.setAttribute("data-app-favicon", "");
        document.head.appendChild(link);
      }
      link.href = href;
    };

    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return null;
}
