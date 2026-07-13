import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";
import { MODES } from "#/workbench/depth";
import { WorkbenchProvider } from "#/workbench/provider";
import { ChatShell } from "#/components/chat-shell";

/**
 * Chat URL state — the single home for navigable/shareable state. TanStack Router owns all of it
 * (validateSearch + the middlewares below); nothing hand-rolls `new URL().searchParams`.
 *   thread — which thread is open (empty/absent = auto-land on latest or a fresh one)
 *   mode   — chat | trace | world view depth (default stripped from the URL)
 *   turn   — turn number to focal-scroll on open/share (absent = tail)
 *   prompt — short composer draft; the composer drops it from the URL past PROMPT_MAX or when
 *            attachments are present (attachments never serialize).
 */
export const PROMPT_MAX = 2000;

const DEFAULTS = { mode: "threads" as const };

const chatSearchSchema = z.object({
  thread: z.string().optional(),
  // .catch keeps stale bookmarks (e.g. the old mode=chat) from throwing — they fall back to default.
  mode: z
    .enum(MODES as [string, ...string[]])
    .default(DEFAULTS.mode)
    .catch(DEFAULTS.mode),
  turn: z.coerce.number().int().positive().optional().catch(undefined),
  plugin: z
    .enum(["family-types", "parameter-links", "settings", "schedule-grid"])
    .optional()
    .catch(undefined),
  prompt: z.string().max(PROMPT_MAX).optional(),
});

export const Route = createFileRoute("/chat")({
  validateSearch: chatSearchSchema,
  search: {
    middlewares: [retainSearchParams(["thread"]), stripSearchParams(DEFAULTS)],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { plugin, prompt, turn } = Route.useSearch();
  const navigate = useNavigate({ from: "/chat" });
  // Debounce the scroll-driven turn → URL write: scrolling fires turn changes every frame, and each
  // navigate re-renders the route. ~1s lag keeps the shareable URL fresh without thrashing the router
  // (and the Lens reads `turn` only for the initial snap, so a lagging URL never re-scrolls the view).
  const turnTimer = useRef<number>(0);
  const setTurn = useCallback(
    (next: number | undefined) => {
      window.clearTimeout(turnTimer.current);
      turnTimer.current = window.setTimeout(() => {
        void navigate({ search: (prev) => ({ ...prev, turn: next }), replace: true });
      }, 1000);
    },
    [navigate],
  );
  useEffect(() => () => window.clearTimeout(turnTimer.current), []);
  // The workbench is a browser-only app (local server fetch + SSE streaming + hotkeys/localStorage).
  // Mount client-only to keep it out of SSR/hydration entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WorkbenchProvider>
      <ChatShell
        initialTurn={turn}
        plugin={plugin}
        promptSeed={prompt}
        onTurnChange={setTurn}
        onPluginClose={() => void navigate({ search: (prev) => ({ ...prev, plugin: undefined }) })}
      />
    </WorkbenchProvider>
  );
}
