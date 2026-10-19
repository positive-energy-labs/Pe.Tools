export type Mode = "threads" | "world";

export const MODES: Mode[] = ["threads", "world"];

export const MODE_HINT: Record<Mode, string> = {
  threads: "Your recent threads — pick one, start fresh, or search all (⌘K).",
  world: "The world inspector: the harness's own count of context used and free.",
};
