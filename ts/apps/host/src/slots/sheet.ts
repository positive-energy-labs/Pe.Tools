import type { SheetSlotData } from "@pe/agent-contracts/slots";
import type { WriteSeal } from "@pe/agent-contracts";

/*
 * The host side of the sheet slot (ADR 0030 rule 4): `sheet.plan` derives the parameter and store
 * writes from a route's Work and returns the seal without opening a transaction (a Read); `sheet.apply`
 * takes the seal, rechecks it and commits through one generic catalog ModelWrite that sets parameter
 * values (owed to C#, `Pe.Revit.Global/Lib/Parameters`). One pair for every route and every Pod.
 * Owner: slice 7.
 */

export interface SheetPlanInput {
  readonly route: string;
  readonly sheet: SheetSlotData;
  /** The staged cells: binding, subject code and value, as the Work holds them. */
  readonly staged: readonly { readonly binding: string; readonly subject?: string; readonly value: unknown }[];
}

export interface SheetPlan {
  readonly seal: WriteSeal;
  readonly writes: readonly { readonly subject: string; readonly parameter: string; readonly before: unknown; readonly after: unknown }[];
  readonly refusals: readonly { readonly subject: string; readonly reason: string }[];
}

export function sheetPlan(input: SheetPlanInput): Promise<SheetPlan> {
  void input;
  throw Error("not implemented: slice 7 (sheet.plan is a Read that returns the seal)");
}

export function sheetApply(seal: WriteSeal): Promise<{ readonly applied: number }> {
  void seal;
  throw Error("not implemented: slice 7 (sheet.apply is the ModelWrite that takes the seal)");
}
