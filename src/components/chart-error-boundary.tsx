"use client";

import * as React from "react";

/**
 * Contains a render/commit crash in a heavy client-only widget (the recharts
 * charts) so a failure there can't abort the whole page. React forwards
 * commit-phase errors (e.g. a recharts `removeChild` on null) to the nearest
 * boundary via `captureCommitPhaseError`, so wrapping each chart keeps the rest
 * of the dashboard interactive. `label` tags the console log so we can tell
 * which chart failed in production.
 */
export class ChartErrorBoundary extends React.Component<
  { label: string; fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[CHART-CRASH:${this.props.label}]`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
