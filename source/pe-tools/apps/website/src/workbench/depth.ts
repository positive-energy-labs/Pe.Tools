import { useCallback, useState } from "react";

/**
 * One view, one scroll. Modes don't swap UIs — they toggle which panes are visible over
 * the single parallax layout (MapDial gutter + chat + detail lane). `chat` shows the
 * conversation only (tool calls collapse to one inline line); `trace` adds the detail lane
 * with tool input/output, reasoning, memory, and context.
 */
export type Mode = "chat" | "trace";

export const MODES: Mode[] = ["chat", "trace"];

export const MODE_HINT: Record<Mode, string> = {
  chat: "Just the conversation. Tool calls collapse to one line.",
  trace: "Adds the detail lane: tool input/output, reasoning, memory, context.",
};

/** Depth drives the ContextStrip reveal (system prompt / injected context). */
export type Depth = "read" | "trace";

export function modeDepth(mode: Mode): Depth {
  return mode === "chat" ? "read" : "trace";
}

const STORAGE_KEY = "pe.view.mode";

function readStoredMode(): Mode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    // "strata"/"lens" were the old devtools depth — folded away; fall back to trace.
    if (value === "strata" || value === "lens") return "trace";
    return MODES.includes(value as Mode) ? (value as Mode) : "chat";
  } catch {
    return "chat";
  }
}

export function useMode(): [Mode, (mode: Mode) => void] {
  const [mode, setModeState] = useState<Mode>(readStoredMode);
  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ponytail: localStorage may be blocked (private mode); mode just won't persist.
    }
  }, []);
  return [mode, setMode];
}
