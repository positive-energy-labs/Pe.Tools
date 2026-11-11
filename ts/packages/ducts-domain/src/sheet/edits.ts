import { criteriaCellOf } from "@pe/agent-contracts";
import type {
  SheetEdits,
  RouteStatePatch,
} from "@pe/agent-contracts";
import { EDIT_SEGMENTS, END_KEY, FITTING_DROP_CELL, JOIN_KEY } from "./inputs.ts";

/**
 * A sheet's edits as Work patches: one per record key (`null` deletes the pending edit), one per
 * criterion and side, join and end rulings as `assumptions` verdicts
 * (`clear` writes a delete rung, which also takes back a verdict the model's store holds), and a
 * proposed fitting's per-path drop as a `component-drop:proposed:…` override.
 */
export function editPatches(edits: SheetEdits): RouteStatePatch[] {
  const patches: RouteStatePatch[] = [];
  for (const [field, segment] of Object.entries(EDIT_SEGMENTS) as [
    keyof typeof EDIT_SEGMENTS,
    string,
  ][]) {
    for (const [key, value] of Object.entries(edits[field] ?? {}))
      patches.push(
        value === null
          ? { path: [segment, key] }
          : { path: [segment, key, "edit"], value: { value } },
      );
  }
  // One cell per criterion and side: a value stages it, null removes its pending edit, absent keeps it.
  for (const [key, value] of Object.entries(edits.criteria ?? {})) {
    const sides = value !== null && typeof value === "object" ? Object.entries(value) : [[undefined, value] as const];
    for (const [side, n] of sides) {
      const cell = criteriaCellOf(key, side);
      if (!cell || n === undefined) continue;
      patches.push(n === null ? { path: ["criteria", cell] } : { path: ["criteria", cell, "edit"], value: { value: n } });
    }
  }
  for (const { pair, verdict } of edits.joins ?? [])
    patches.push(
      verdict === "clear"
        ? { path: ["assumptions", JOIN_KEY(pair), "edit"], value: { delete: true } }
        : {
            path: ["assumptions", JOIN_KEY(pair), "edit"],
            value: {
              value: { kind: "verdict", verdict: verdict === "accept" ? "connect" : "ignore" },
            },
          },
    );
  // A typed drop on one path through a proposed fitting: an override cell, never written to Revit.
  for (const [key, value] of Object.entries(edits.fittingDrops ?? {}))
    patches.push(
      value === null
        ? { path: ["assumptions", FITTING_DROP_CELL(key)] }
        : {
            path: ["assumptions", FITTING_DROP_CELL(key), "edit"],
            value: { value: { kind: "component-drop", inWg: value.inWg } },
          },
    );
  for (const { end, verdict } of edits.ends ?? [])
    patches.push(
      verdict === "clear"
        ? { path: ["assumptions", END_KEY(end), "edit"], value: { delete: true } }
        : {
            path: ["assumptions", END_KEY(end), "edit"],
            value: { value: { kind: "verdict", verdict: "capped" } },
          },
    );
  return patches;
}
