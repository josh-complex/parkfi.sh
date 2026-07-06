"use client";

import * as React from "react";

import { reportError } from "#/lib/report-error.ts";

/**
 * Contains a render/commit crash in a heavy client-only widget (the visx
 * charts) so a failure there can't abort the whole page. React forwards
 * commit-phase errors to the nearest boundary via `captureCommitPhaseError`, so
 * wrapping each chart keeps the rest of the dashboard interactive. `label` tags
 * the console log so we can tell which chart failed in production.
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
    // Degraded: the rest of the dashboard stays interactive, so no toast — but
    // this is exactly the class of bug (recharts "r is not a function") that
    // previously shipped to prod undetected, so it must be captured.
    reportError(error, {
      source: "render",
      severity: "degraded",
      toast: false,
      context: { chart: this.props.label },
    });
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
