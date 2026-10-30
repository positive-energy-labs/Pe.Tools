/**
 * The host side of the inputs resolver (ducts LEDGER 2026-10-29): load the layers the pure
 * `resolveInputs` reads (Work's staged edits, the firm file) and turn a sheet's `edits` into Work
 * patches. The firm file is the base layer under every project criterion; absent, the seed below
 * stands in and says so (`present: false`), so a sheet never prices on an unnamed constant.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ductsFirmSchema,
  stagedDucts,
  type DuctsCriteriaEdits,
  type DuctsCriteriaLayer,
  type DuctsFirm,
  type DuctsRouteDocument,
  type DuctsSheetEdits,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import {
  EDIT_SEGMENTS,
  END_KEY,
  FITTING_DROP_CELL,
  JOIN_KEY,
  type WorkLayer,
} from "@pe/ducts-domain/sheet/index";
import { productUserContentRootPath } from "./product-paths.ts";

export const firmFilePath = () => join(productUserContentRootPath(), "Firm", "ducts.json");

// firm-default: what a firm with no file yet runs on. Velocity limits are Manual D's rules of
// thumb (trunk 900 supply, 700 return); 0.03 in-wg is the grille placeholder; 3 in and 36 in are
// the Q5 auto-join gap and the Q6 heal box. The firm's own numbers belong in the file.
export const FIRM_SEED: DuctsFirm = {
  version: "seed",
  criteria: {
    velocityLimitFpm: { supply: 900, return: 700 },
    terminalDropInWg: 0.03,
    autoJoinGapIn: 3,
    healBoxIn: 36,
    splitPolicy: "even",
    allowanceInWg: { supply: 0, return: 0 },
  },
};

export interface FirmReading {
  firm: DuctsFirm;
  path: string;
  present: boolean;
  /** Why the file was not used, when it exists and does not parse. */
  error?: string;
}

export async function readFirm(path = firmFilePath()): Promise<FirmReading> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { firm: FIRM_SEED, path, present: false };
    return { firm: FIRM_SEED, path, present: false, error: String(error) };
  }
  const parsed = ductsFirmSchema.safeParse(JSON.parse(text));
  if (!parsed.success)
    return { firm: FIRM_SEED, path, present: false, error: parsed.error.message };
  return { firm: parsed.data, path, present: true };
}

/** Work's staged edits as the resolver reads them. */
export function workLayer(doc: DuctsRouteDocument | null): WorkLayer {
  const staged = stagedDucts(doc);
  return {
    flows: staged.flows,
    terminalDrops: staged.terminalDrops,
    componentDrops: staged.componentDrops,
    esp: staged.esp,
    equipmentFlows: staged.equipmentFlows,
    roles: staged.roles,
    kinds: staged.kinds,
    criteria: staged.criteria,
    rules: staged.rules,
    ruleAssignments: staged.ruleAssignments,
    catalogs: staged.catalogs,
    assumptions: staged.assumptions as WorkLayer["assumptions"],
  };
}


/**
 * A criteria edit over the staged project layer, per criterion and per side: a value writes, null
 * removes, an absent key or side keeps what is staged. A sided criterion left with no side drops.
 */
export function mergeCriteria(staged: DuctsCriteriaLayer, edits: DuctsCriteriaEdits): DuctsCriteriaLayer {
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
export function editPatches(edits: DuctsSheetEdits, doc: DuctsRouteDocument | null): RouteStatePatch[] {
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
            value: { value: { kind: "verdict", verdict: verdict === "accept" ? "connect" : "ignore" } },
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
