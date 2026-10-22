import { createFileRoute, retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { MODES } from "#/workbench/depth";
import { ChatShell } from "#/chat/chat-shell";
/**
 * Chat URL state — the single home for navigable/shareable state. TanStack Router owns all of it
 * (validateSearch + the middlewares below); nothing hand-rolls `new URL().searchParams`.
 *   thread — which thread is open (empty/absent = latest existing thread, else the empty
 *            state)
 *   mode   — threads | world sidebar view (default stripped from the URL)
 *   turn   — turn number to focal-scroll on open/share (absent = tail)
 *   prompt — short composer draft; the composer drops it from the URL past PROMPT_MAX or when
 *            attachments are present (attachments never serialize).
 * `?demo=<action>` is read by `useRoute`, not here: it mounts one seed in an isolated owner.
 */
export const PROMPT_MAX = 200;

const DEFAULTS = { mode: "threads" as const };

export const chatSearchSchema = z.object({
  thread: z.string().optional(),
  // .catch keeps stale bookmarks (e.g. the old mode=chat) from throwing — they fall back to default.
  mode: z
    .enum(MODES as [string, ...string[]])
    .default(DEFAULTS.mode)
    .catch(DEFAULTS.mode),
  turn: z.coerce.number().int().positive().optional().catch(undefined),
  prompt: z.string().max(PROMPT_MAX).optional(),
});

export const Route = createFileRoute("/pea")({
  validateSearch: chatSearchSchema,
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

export function ChatRouteContent({
  target,
}: Pick<z.infer<typeof chatSearchSchema>, "thread"> & { target?: string }) {
  return <ChatShell target={target} />;
}
