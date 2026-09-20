/**
 * THE STAGED APPLY'S OUTCOME (F-J3-3 / F-J3-4, exec-draft's web meaning). A staged sheet applies
 * as one `families.apply` action per plan. The verb's outcome counts per-family receipts across
 * all of them and names each failed family with its reason; one action's reason never stands for
 * the verb. A refusal (failed with no steps: nothing ran) is not a failure.
 */
import { ffReceiptSchema, type ActionReceipt } from "@pe/agent-contracts";

import { refuse, type Refusal } from "#/route/refusal";

/** One plan's action, with the names of the families that plan held. */
export interface PlanRun {
  readonly families: readonly string[];
  readonly action: ActionReceipt;
}

export function applyOutcome(runs: readonly PlanRun[], planned: number): Refusal | null {
  let applied = 0;
  const failed: string[] = [];
  const refused: string[] = [];
  for (const { families, action } of runs) {
    if (action.state === "succeeded") {
      const step = action.steps.find(
        (one) => one.key === "families.apply" && one.state === "succeeded",
      );
      const native = (step?.state === "succeeded" ? step.result : undefined) as
        | { receipts?: unknown[] }
        | undefined;
      for (const receipt of ffReceiptSchema.array().parse(native?.receipts ?? [])) {
        if (receipt.success) applied += 1;
        else
          failed.push(
            `${receipt.familyName} (${receipt.error ?? receipt.errors.join(", ") ?? "no reason given"})`,
          );
      }
    } else if (action.state === "failed" && action.steps.length === 0) {
      refused.push(action.error);
    } else {
      const reason = "error" in action ? action.error : `families.apply ${action.state}`;
      for (const name of families) failed.push(`${name} (${reason})`);
    }
  }
  if (!failed.length && !refused.length) return null;
  if (!applied && !failed.length)
    return refuse("not-ready", `refused — nothing ran: ${[...new Set(refused)].join("; ")}`);
  if (!applied && !refused.length)
    return refuse("failed", `failed in Revit — nothing changed: ${failed.join("; ")}`);
  const notRun = refused.length ? `; not run: ${[...new Set(refused)].join("; ")}` : "";
  return refuse(
    "partial",
    `partly applied: ${applied} written, ${planned - applied} refused${failed.length ? `; failed: ${failed.join("; ")}` : ""}${notRun}`,
  );
}
