import type { DuctsSheetInputs } from "@pe/agent-contracts";

/** Keyed edits merge; explicit clears remove only the named values. Arrays remain whole rulings. */
export function mergeSheetInputs(
  saved: DuctsSheetInputs,
  edits: DuctsSheetInputs,
): DuctsSheetInputs {
  const { clear, ...rest } = edits;
  const { clear: _, ...base } = saved;
  const result = { ...base, ...rest };
  for (const key of ["endCfm", "drops", "unitCfm"] as const) {
    const values = { ...saved[key], ...edits[key] };
    for (const id of clear?.[key] ?? []) delete values[id];
    if (saved[key] || edits[key] || clear?.[key]) result[key] = values;
  }
  return result;
}
