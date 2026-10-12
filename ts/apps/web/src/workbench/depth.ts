export type Mode = "threads" | "trace" | "world";

export const MODES: Mode[] = ["threads", "trace", "world"];

export const MODE_HINT: Record<Mode, string> = {
  threads: "Your recent threads — pick one, start fresh, or search all (⌘K).",
  trace: "The detail lane: tool input/output and reasoning.",
  world: "The world inspector: the harness's own count of context used and free.",
};
