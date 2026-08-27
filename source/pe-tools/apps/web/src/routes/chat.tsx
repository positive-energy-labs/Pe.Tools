import {
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { z } from "zod";
import { MODES } from "#/workbench/depth";
import { WorkbenchProvider } from "#/workbench/provider";
import { ChatShell } from "#/components/chat-shell";
import { CHAT_PLUGIN_ROUTES } from "#/workbench/route-chat-plugins";

/**
 * Chat URL state — the single home for navigable/shareable state. TanStack Router owns all of it
 * (validateSearch + the middlewares below); nothing hand-rolls `new URL().searchParams`.
 *   thread — which thread is open (empty/absent = latest existing thread, else the empty
 *            state)
 *   mode   — chat | trace | world view depth (default stripped from the URL)
 *   turn   — turn number to focal-scroll on open/share (absent = tail)
 *   target — pinned Revit session selector ("observed", "session:<id>", pid…), retained like thread.
 *            A SELECTOR, never a session id, so the pin survives process restarts.
 *   prompt — short composer draft; the composer drops it from the URL past PROMPT_MAX or when
 *            attachments are present (attachments never serialize).
 */
export const PROMPT_MAX = 200;

const DEFAULTS = { mode: "threads" as const };

const chatSearchSchema = z.object({
  thread: z.string().optional(),
  // .catch keeps stale bookmarks (e.g. the old mode=chat) from throwing — they fall back to default.
  mode: z
    .enum(MODES as [string, ...string[]])
    .default(DEFAULTS.mode)
    .catch(DEFAULTS.mode),
  turn: z.coerce.number().int().positive().optional().catch(undefined),
  plugin: z.enum(CHAT_PLUGIN_ROUTES).optional().catch(undefined),
  target: z.string().optional().catch(undefined),
  prompt: z.string().max(PROMPT_MAX).optional(),
});

export const Route = createFileRoute("/chat")({
  validateSearch: chatSearchSchema,
  search: {
    middlewares: [retainSearchParams(["thread", "target"]), stripSearchParams(DEFAULTS)],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { plugin, thread, turn } = Route.useSearch();
  return (
    <WorkbenchProvider key={thread ?? "draft"}>
      <ChatShell initialTurn={turn} plugin={plugin} />
    </WorkbenchProvider>
  );
}
