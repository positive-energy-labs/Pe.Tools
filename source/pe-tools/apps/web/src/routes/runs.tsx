// /runs — the dev-only takeoff run browser. Promoted at find-the-product round close, 2026-08-17:
// the round-2 combo IS the surface, so there is no variant search param and no switcher — one
// capability, one path. The body lives in src/runs/browser.tsx.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import RunBrowser from "../runs/browser";
import { FixtureRunsProvider } from "../runs/fixture";

export const runsSearch = (search: Record<string, unknown>): { source?: "fixture" } => ({
  source: search.source === "fixture" ? "fixture" : undefined,
});

export const Route = createFileRoute("/runs")({
  validateSearch: runsSearch,
  component: RunsPage,
});

function RunsPage() {
  // Dev-only surface pinned to light chrome (kaitpw ruling, round 2): the plan/card palettes
  // are calibrated against light ground; restore the profile's theme on leave.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const colorScheme = root.style.colorScheme;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    return () => {
      if (hadDark) root.classList.add("dark");
      root.style.colorScheme = colorScheme;
    };
  }, []);
  if (!import.meta.env.DEV) {
    return <div className="p-8 text-ink-2">/runs is a dev-only surface.</div>;
  }
  return <RunsRouteContent source={Route.useSearch().source} />;
}

export function RunsRouteContent({ source }: { source?: "fixture" }) {
  return source === "fixture" ? (
    <FixtureRunsProvider>
      <RunBrowser />
    </FixtureRunsProvider>
  ) : (
    <RunBrowser />
  );
}
