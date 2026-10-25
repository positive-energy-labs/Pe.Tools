/** Shared by list controls and the unmounted reference map. */
import type { ActionDefinition } from "../../keys";
export const LIST_ACTIONS = {
  next: {
    id: "list.next",
    bindings: ["ArrowDown"],
    label: "next",
    description: "move the cursor down",
  },
  previous: {
    id: "list.previous",
    bindings: ["ArrowUp"],
    label: "previous",
    description: "move the cursor up",
  },
  first: { id: "list.first", bindings: ["Home"], label: "first", description: "the first row" },
  last: { id: "list.last", bindings: ["End"], label: "last", description: "the last row" },
  pick: {
    id: "list.pick",
    bindings: ["Enter"],
    label: "pick",
    description: "pick the row under the cursor",
  },
  back: {
    id: "list.back",
    bindings: ["Escape"],
    label: "back",
    description: "clear the query, go up a level, or close",
  },
} as const satisfies Record<string, Omit<ActionDefinition, "invoke">>;
export const LIST_SEARCH_SYNTAX = [
  "Words search row text and exact element ids",
  "Pick a field, then a value; filters are ANDed",
  "Tab completes; Backspace edits the last filter",
] as const;
export const SEARCH_FOCUS_SYNTAX = ["/ focuses this search"] as const;
