/** Shared by list controls and the unmounted reference map. */
export const LIST_SEARCH_SYNTAX = [
  "Words search row text and exact element ids",
  "Pick a field, then a value; filters are ANDed",
  "Tab completes; Backspace edits the last filter",
] as const;
export const SEARCH_FOCUS_SYNTAX = ["/ focuses this search"] as const;
