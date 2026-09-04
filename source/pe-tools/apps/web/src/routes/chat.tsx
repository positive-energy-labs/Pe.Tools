import { createFileRoute, retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { MODES } from "#/workbench/depth";
import { WorkbenchProvider } from "#/workbench/provider";
import { ChatShell } from "#/chat/chat-shell";
import { CHAT_PLUGIN_ROUTES } from "#/workbench/route-chat-plugins";
import { FixtureWorkbenchProvider } from "#/workbench/fixture";

/**
 * Chat URL state — the single home for navigable/shareable state. TanStack Router owns all of it
 * (validateSearch + the middlewares below); nothing hand-rolls `new URL().searchParams`.
 *   thread — which thread is open (empty/absent = latest existing thread, else the empty
 *            state)
 *   mode   — chat | trace | world view depth (default stripped from the URL)
 *   turn   — turn number to focal-scroll on open/share (absent = tail)
 *   scope  — fixture only: which Scope head state to draw (set | dangling | absent).
 *   prompt — short composer draft; the composer drops it from the URL past PROMPT_MAX or when
 *            attachments are present (attachments never serialize).
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
  plugin: z.enum(CHAT_PLUGIN_ROUTES).optional().catch(undefined),
  scope: z.enum(["set", "dangling", "absent"]).optional().catch(undefined),
  prompt: z.string().max(PROMPT_MAX).optional(),
  source: z.enum(["live", "fixture"]).optional().catch(undefined),
});

export const Route = createFileRoute("/chat")({
  validateSearch: chatSearchSchema,
  search: {
    middlewares: [retainSearchParams(["thread"]), stripSearchParams(DEFAULTS)],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { plugin, source, thread, turn } = Route.useSearch();
  return <ChatRouteContent plugin={plugin} source={source} thread={thread} turn={turn} />;
}

export function ChatRouteContent({
  plugin,
  source,
  thread,
  turn,
}: Pick<z.infer<typeof chatSearchSchema>, "plugin" | "source" | "thread" | "turn">) {
  if (source === "fixture")
    return (
      <FixtureWorkbenchProvider>
        <ChatShell initialTurn={turn} plugin={plugin} live={false} />
      </FixtureWorkbenchProvider>
    );
  return (
    <WorkbenchProvider key={thread ?? "draft"}>
      <ChatShell initialTurn={turn} plugin={plugin} />
    </WorkbenchProvider>
  );
}
