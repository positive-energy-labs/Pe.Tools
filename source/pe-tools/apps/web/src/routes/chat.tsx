import { createFileRoute, retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { MODES } from "#/workbench/depth";
import { WorkbenchProvider } from "#/workbench/provider";
import { ChatShell } from "#/chat/chat-shell";
import { chatManifest } from "#/chat/manifest";
import { CHAT_PLUGIN_ROUTES } from "#/workbench/chat-plugins";
/**
 * Chat URL state — the single home for navigable/shareable state. TanStack Router owns all of it
 * (validateSearch + the middlewares below); nothing hand-rolls `new URL().searchParams`.
 *   thread — which thread is open (empty/absent = latest existing thread, else the empty
 *            state)
 *   mode   — chat | trace | world view depth (default stripped from the URL)
 *   turn   — turn number to focal-scroll on open/share (absent = tail)
 *   plugin — the route hosted in the plugin pane; focus — the group path (canonical JSON) the
 *            head's drill-in scoped it to. Opening a plugin any other way clears the focus.
 *   prompt — short composer draft; the composer drops it from the URL past PROMPT_MAX or when
 *            attachments are present (attachments never serialize).
 * `?demo=<action>` is read by `useRoute`, not here: it mounts one seed in an isolated owner.
 */
export const PROMPT_MAX = 200;

const DEFAULTS = { mode: "threads" as const };

export const chatSearchSchema = z.object({
  variant: z.enum(["A", "B", "C"]).optional().catch(undefined),
  thread: z.string().optional(),
  // .catch keeps stale bookmarks (e.g. the old mode=chat) from throwing — they fall back to default.
  mode: z
    .enum(MODES as [string, ...string[]])
    .default(DEFAULTS.mode)
    .catch(DEFAULTS.mode),
  turn: z.coerce.number().int().positive().optional().catch(undefined),
  plugin: z.enum(CHAT_PLUGIN_ROUTES).optional().catch(undefined),
  focus: z.string().optional().catch(undefined),
  prompt: z.string().max(PROMPT_MAX).optional(),
});

/** The route, declared once. `chat-shell` re-derives it with the live session bound. */
export const manifest = chatManifest({ thread: "" });

export const Route = createFileRoute("/chat")({
  validateSearch: chatSearchSchema,
  search: {
    middlewares: [retainSearchParams(["thread"]), stripSearchParams(DEFAULTS)],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { plugin, focus, thread } = Route.useSearch();
  return <ChatRouteContent plugin={plugin} focus={focus} thread={thread} />;
}

export function ChatRouteContent({
  plugin,
  focus,
}: Pick<z.infer<typeof chatSearchSchema>, "plugin" | "focus" | "thread">) {
  return (
    <WorkbenchProvider>
      <ChatShell plugin={plugin} focus={focus} />
    </WorkbenchProvider>
  );
}
