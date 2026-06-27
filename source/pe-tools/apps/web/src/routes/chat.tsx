import { useCallback, useEffect, useState } from "react";
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

const DEFAULTS = { mode: "chat" as const };

const chatSearchSchema = z.object({
  thread: z.string().optional(),
  mode: z.enum(MODES as [string, ...string[]]).default(DEFAULTS.mode),
  turn: z.coerce.number().int().positive().optional().catch(undefined),
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
  const { prompt, turn } = Route.useSearch();
  const navigate = useNavigate({ from: "/chat" });
  const setTurn = useCallback(
    (next: number | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, turn: next }), replace: true });
    },
    [navigate],
  );
  // The workbench is a browser-only app (local server fetch + SSE streaming + hotkeys/localStorage).
  // Mount client-only to keep it out of SSR/hydration entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WorkbenchProvider>
      <ChatShell initialTurn={turn} promptSeed={prompt} onTurnChange={setTurn} />
    </WorkbenchProvider>
  );
}
