/**
 * /family — the route shell. Everything the surface IS lives in `#/family/workspace`.
 *
 * PROMOTED 2026-08-16. This route used to carry a two-lane workspace (an authored `family.json`
 * bound through route:settings, and the family open in Revit's family editor through
 * family.editor.snapshot/apply) plus the `?variant=` gate that mounted the clean-room rebuilds
 * beside it. The clean room ruled: variant e IS the product, so it stopped being a variant and
 * became the route. The rivals are on snapshot branch `proto/family-variants-2026-08`; the
 * superseded two-lane surface and its twelve modules are in git at `0af4260`.
 *
 * WHAT THE ROUTE STILL OWNS, and why each survived the promotion:
 *   `thread` — the chat side pane iframes this route with a thread id, and `#/workbench/route-state`
 *     reads it straight off the URL to scope route state to that conversation. Declared here
 *     because an undeclared param is dropped on the first navigation, and the pane would then
 *     silently fall back to workspace scope. Nothing on the page reads it; the router does.
 *   `family` — `/families` row navigation passes an element id. The promoted surface reads one
 *     fixture profile and cannot open an arbitrary family, so it is handed to the workspace and
 *     SAID rather than swallowed: the header renders an advisory naming what would honour it.
 *
 * WHAT WENT: `?mock`, because the whole surface is now a declared fixture lane and a flag that
 * chooses between fixture and fixture is a lie; `?variant`, because there is nothing to switch to.
 */
import { createFileRoute } from "@tanstack/react-router";

import { FamilyWorkspace } from "#/family/workspace";

export const Route = createFileRoute("/family")({
  /** Every param is optional, so every `<Link to="/family">` stays search-free. */
  validateSearch: (search: Record<string, unknown>): { family?: string; thread?: string } => ({
    family:
      typeof search.family === "string" && search.family.trim() ? search.family.trim() : undefined,
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  component: FamilyRoute,
});

function FamilyRoute() {
  const { family } = Route.useSearch();
  return <FamilyWorkspace requestedFamily={family} />;
}
