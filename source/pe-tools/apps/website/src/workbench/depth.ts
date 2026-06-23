import { useCallback, useState } from "react";

/**
 * One view, one scroll. Modes don't swap UIs — they toggle which panes are visible over
 * the single parallax layout (MapDial gutter + chat + detail/event lanes). `chat` shows
 * the conversation only; `trace` adds the detail lane; `strata` adds the raw-events lane.
 * The old separate Marginalia/Lens views collapsed into this.
 */
export type Mode = "chat" | "trace" | "strata";

export const MODES: Mode[] = ["chat", "trace", "strata"];

export const MODE_HINT: Record<Mode, string> = {
  chat: "Just the conversation. Tool calls collapse to one line.",
  trace: "Adds the detail lane: tool input/output, reasoning, memory, context.",
  strata: "Adds the raw ag-ui events lane, sequence-numbered.",
};

/** Depth drives the ContextStrip reveal (system prompt / injected context). */
export type Depth = "read" | "trace" | "strata";

export function modeDepth(mode: Mode): Depth {
  return mode === "chat" ? "read" : mode;
}

const STORAGE_KEY = "pe.view.mode";

function readStoredMode(): Mode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "lens") return "strata"; // lens folded into the substrate
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
