import type {
  DuctsCriteriaEdits,
  DuctsCriteriaLayer,
  DuctsRouteDocument,
  DuctsSheetEdits,
  RouteStatePatch,
} from "@pe/agent-contracts";
import { EDIT_SEGMENTS, END_KEY, FITTING_DROP_CELL, JOIN_KEY } from "./inputs.ts";

/**
 * A criteria edit over the staged project layer, per criterion and per side: a value writes, null
 * removes, an absent key or side keeps what is staged. A sided criterion left with no side drops.
 */
export function mergeCriteria(
  staged: DuctsCriteriaLayer,
  edits: DuctsCriteriaEdits,
): DuctsCriteriaLayer {
  const merged: Record<string, unknown> = { ...staged };
  for (const [key, value] of Object.entries(edits)) {
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else if (typeof value === "object") {
      const sides: Record<string, unknown> = { ...(merged[key] as object | undefined) };
      for (const [side, n] of Object.entries(value))
        if (n === null) delete sides[side];
        else if (n !== undefined) sides[side] = n;
      if (Object.keys(sides).length) merged[key] = sides;
      else delete merged[key];
    } else merged[key] = value;
  }
  return merged as DuctsCriteriaLayer;
}

/**
 * A sheet's edits as Work patches: one per record key (`null` deletes the pending edit), the
 * criteria cell merged over what is staged, join and end rulings as `assumptions` verdicts
 * (`clear` writes a delete rung, which also takes back a verdict the model's store holds), and a
 * proposed fitting's per-path drop as a `component-drop:proposed:…` override.
 */
export function editPatches(
  edits: DuctsSheetEdits,
  doc: DuctsRouteDocument | null,
): RouteStatePatch[] {
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
  if (edits.criteria)
    patches.push({
      path: ["criteria", "edit"],
      value: { value: mergeCriteria(doc?.criteria?.edit?.value ?? {}, edits.criteria) },
    });
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
