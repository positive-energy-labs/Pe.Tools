import {
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { routeSearch } from "#/route/route-owner";
import { ChatShell } from "#/chat/chat-shell";
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
/** The contract defaults (`routeAddress("pea")`): a stale value (the old `mode=chat`) reads as one. */
const DEFAULTS = routeAddress("pea").defaults;

export const Route = createFileRoute("/pea")({
  validateSearch: (search: SearchSchemaInput & Record<string, unknown>) => ({
    ...routeSearch(search),
    ...routeAddress("pea").read(search).page,
  }),
  search: {
    middlewares: [retainSearchParams(["thread"]), stripSearchParams(DEFAULTS)],
  },
  component: RouteComponent,
});

function RouteComponent() {
  // `target` is the root's retained pin (routes/__root.tsx), carried across every Chat link.
  const { thread, target } = Route.useSearch();
  return <ChatRouteContent thread={thread} target={target} />;
}

export function ChatRouteContent({ target }: { thread?: string; target?: string }) {
  return <ChatShell target={target} />;
}
