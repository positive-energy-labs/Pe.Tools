/**
 * THE STAGED APPLY'S OUTCOME (F-J3-3 / F-J3-4, exec-draft's web meaning). A staged sheet applies
 * as one `families.apply` action per plan. The verb's outcome counts per-family receipts across
 * all of them and names each failed family with its reason; one action's reason never stands for
 * the verb. A proven non-dispatch is a refusal, not a failure.
 */
import { ffReceiptSchema, type ActionReceipt } from "@pe/agent-contracts";

import { refuse, type Refusal } from "#/route/refusal";

/** One plan's action, with the names of the families that plan held. */
export interface PlanRun {
  readonly families: readonly string[];
  readonly action: ActionReceipt;
}

/** The per-family receipts one plan's action reported; none unless its apply step succeeded. */
const receiptsOf = (action: ActionReceipt) => {
  const step = action.steps.find(
    (one) => one.key === "families.apply" && one.state === "succeeded",
  );
  const native = (step?.state === "succeeded" ? step.result : undefined) as
    | { receipts?: unknown[] }
    | undefined;
  return ffReceiptSchema.array().parse(native?.receipts ?? []);
};

/**
 * One apply's receipts in counts, and the run's artifact directory: the one directory every
 * receipt's bundle sits in (their common parent), or null when no receipt names one on disk.
 */
export function applyTally(runs: readonly PlanRun[]) {
  const receipts = runs.flatMap(({ action }) => receiptsOf(action));
  const dirs = [
    ...new Set(receipts.flatMap((r) => (r.artifactDirectory ? [r.artifactDirectory] : []))),
  ];
  const common = dirs.reduce((a, b) => {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  }, dirs[0] ?? "");
  return {
    families: receipts.length,
    converged: receipts.filter((r) => r.converged).length,
    residue: receipts.filter((r) => r.success && !r.converged).length,
    failed: receipts.filter((r) => !r.success).length,
    artifact:
      dirs.length === 1
        ? dirs[0]!
        : common.slice(0, Math.max(common.lastIndexOf("/"), common.lastIndexOf("\\"))) || null,
  };
}

export function applyOutcome(runs: readonly PlanRun[], planned: number): Refusal | null {
  let applied = 0;
  const failed: string[] = [];
  const refused: string[] = [];
  let effectsUnproven = false;
  for (const { families, action } of runs) {
    if (action.state === "succeeded") {
      for (const receipt of receiptsOf(action)) {
        if (receipt.success) applied += 1;
        else
          failed.push(
            `${receipt.familyName} (${receipt.error ?? receipt.errors.join(", ") ?? "no reason given"})`,
          );
      }
    } else if (
      action.state === "failed" &&
      action.notDispatched === true &&
      action.steps.length === 0
    ) {
      refused.push(action.error);
    } else {
      if (!(action.state === "failed" && action.notDispatched === true)) effectsUnproven = true;
      const reason = "error" in action ? action.error : `families.apply ${action.state}`;
      for (const name of families) failed.push(`${name} (${reason})`);
    }
  }
  if (!failed.length && !refused.length) return null;
  if (!applied && !failed.length)
    return refuse("not-ready", `refused — nothing ran: ${[...new Set(refused)].join("; ")}`);
  if (!applied && !refused.length)
    return refuse(
      "failed",
      `failed in Revit — ${effectsUnproven ? "effects unproven" : "nothing changed"}: ${failed.join("; ")}`,
    );
  const notRun = refused.length ? `; not run: ${[...new Set(refused)].join("; ")}` : "";
  return refuse(
    "partial",
    `partly applied: ${applied} written, ${planned - applied} refused${failed.length ? `; failed: ${failed.join("; ")}` : ""}${notRun}`,
  );
}
