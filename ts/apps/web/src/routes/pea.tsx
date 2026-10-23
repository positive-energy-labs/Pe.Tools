import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import { routeFile } from "#/route";
/**
 * Chat URL state — the single home for navigable/shareable state. TanStack Router owns all of it
 * (validateSearch + the middlewares below); nothing hand-rolls `new URL().searchParams`.
 *   thread — which thread is open (empty/absent = latest existing thread, else the empty
 *            state)
 *   mode   — threads | world sidebar view (default stripped from the URL)
 *   turn   — turn number to focal-scroll on open/share (absent = tail)
 *   prompt — short composer draft; the composer drops it from the URL past the contract field's 200 characters or when
 *            attachments are present (attachments never serialize).
 * `?demo=<action>` is read by `useRoute`, not here: it mounts one seed in an isolated owner.
 */
/**
 * The contract's defaults never reach the address, and a stale value (the old `mode=chat`) reads as
 * one (`routeFile`). No lease to Pea: the chat is where Pea reads its own thread, and a thread tab
 * never holds `/pea`, so Pea has no view of this route to set.
 */
const file = routeFile("pea");
export const Route = createFileRoute("/pea")({
  validateSearch: file.validateSearch,
  search: { middlewares: [retainSearchParams(["thread"]), ...file.search.middlewares] },
  component: RouteComponent,
});

function RouteComponent() {
  // RouteDock owns the persistent ChatShell; this leaf owns only its address contract.
  return null;
}
