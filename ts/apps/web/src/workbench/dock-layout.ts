/**
 * The dock as data (ADR 0035 rule 5): Pea starts, the tools pane ends, and the Places tab strip is
 * the tools pane's head. `RouteDock` (route-panes.tsx) derives its chrome from this. Both panes
 * host a route surface whose own panes declare their bodies and carry their heads, so both fill.
 */
import type { PaneBodyDecl } from "#/route/body";

export const DOCK_PANES = {
  pea: { body: "fill" },
  tools: { body: "fill" },
} as const satisfies Readonly<Record<"pea" | "tools", PaneBodyDecl>>;
