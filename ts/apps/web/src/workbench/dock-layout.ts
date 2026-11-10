/**
 * The dock as data (ADR 0035 rule 5): Pea starts, the tools pane ends, and the Places tab strip is
 * the tools pane's head. `RouteDock` (route-panes.tsx) derives its chrome from this; the chat
 * route's own two bodies are /pea's scroll tracks, so the dock's Pea pane fills.
 *
 * Scaffold (slice 6, seam a): no body is declared yet; `RouteDock` still hands `GraphLayoutView`
 * its bodies by hand. The fill declares `tools: { body: "scroll" }` and `pea: { body: "fill" }`
 * and makes `RouteDock` read them.
 */
import type { PaneBodyDecl } from "#/route/body";

export const DOCK_PANES: Readonly<Record<"pea" | "tools", PaneBodyDecl>> = { pea: {}, tools: {} };
