export type Mode = "threads" | "trace" | "world";

export const MODES: Mode[] = ["threads", "trace", "world"];

export const MODE_HINT: Record<Mode, string> = {
  threads: "Your recent threads — pick one, start fresh, or search all (⌘K).",
  trace: "The detail lane: tool input/output, reasoning, memory, context.",
  world:
    "The world inspector: what Pea actually sent the model, ordered by request position, with cache state.",
};

export type Depth = "read" | "trace";

export function modeDepth(mode: Mode): Depth {
  return mode === "threads" ? "read" : "trace";
}
