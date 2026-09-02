import { LawSpecimens } from "#/design-system/specimens/laws";

export const LAW_POINTERS = [
  ["one alarm", "lens.house law 5"],
  ["pea is never blue", "lens.house law 5"],
  ["one filled blue", "lens.house law 5"],
  ["selection is a fill", "lens.house law 5"],
  ["bold = unsaved", "lens.house law 6"],
  ["the squiggle family", "StateCellProps"],
  ["the border budget", "lens.house law 7"],
  ["mono means measured", "lens.house law 6"],
  ["cell state, not columns", "StateCellProps"],
  ["sort by domain order", "CELL_STATE_ORDER"],
  ["a filter's vocabulary is stable", "specimens/integration-table.tsx · RealTable"],
  ["refuse per option", "VerbProps.reason"],
  ["orientation hides behind a mark", "lens.house law 3"],
  ["a stand-in announces itself", "lens.house law 8"],
  ["small type takes opt-in marks", "lens.house law 6"],
  ["provenance rides with the value", "StateCellProps.grounding"],
  ["ceremony scales with blast radius", "ArmingStrip"],
] as const;

export function DesignSystemLaws() {
  return <LawSpecimens pointers={LAW_POINTERS} />;
}
