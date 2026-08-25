// /runs — the dev-only takeoff run browser. Promoted at find-the-product round close, 2026-08-17:
// the round-2 combo IS the surface, so there is no variant search param and no switcher — one
// capability, one path. The body lives in src/runs/browser.tsx.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import RunBrowser from "../runs/browser";

export const Route = createFileRoute("/runs")({ component: RunsPage });

function RunsPage() {
  // Dev-only surface pinned to light chrome (kaitpw ruling, round 2): the plan/card palettes
  // are calibrated against light ground; restore the profile's theme on leave.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDark) root.classList.add("dark");
    };
  }, []);
  if (!import.meta.env.DEV) {
    return <div className="p-8 text-sm text-muted-foreground">/runs is a dev-only surface.</div>;
  }
  return <RunBrowser />;
}
