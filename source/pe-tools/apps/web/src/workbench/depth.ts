/**
 * One view, one scroll. Modes don't swap UIs — they toggle which panes are visible over the
 * single parallax layout (MapDial gutter + chat + detail lane). `chat` shows the conversation
 * only (tool calls collapse to one inline line); `trace` adds the detail lane with tool
 * input/output, reasoning, memory, context; `world` is the context inspector.
 *
 * Mode is URL-canonical now (the `mode` search param), so there's no useMode/localStorage here —
 * the route owns it via TanStack Router search.
 */
export type Mode = "chat" | "trace" | "world";

export const MODES: Mode[] = ["chat", "trace", "world"];

export const MODE_HINT: Record<Mode, string> = {
  chat: "Just the conversation. Tool calls collapse to one line.",
  trace: "Adds the detail lane: tool input/output, reasoning, memory, context.",
  world:
    "The world inspector: what Pea actually sent the model, ordered by request position, with cache state.",
};

/** Depth drives the ContextStrip reveal (system prompt / injected context). */
export type Depth = "read" | "trace";

export function modeDepth(mode: Mode): Depth {
  return mode === "chat" ? "read" : "trace";
}
