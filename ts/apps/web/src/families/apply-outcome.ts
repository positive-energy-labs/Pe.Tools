/** Presentation of the single semantic Families Apply result. */
import { familyApplyResultSchema, type ActionReceipt } from "@pe/agent-contracts";
import { refuse, type Refusal } from "#/route/refusal";

export const applyResults = (result: unknown) => {
  const parsed = familyApplyResultSchema.parse(result);
  return "results" in parsed ? parsed.results : [parsed];
};
const receiptsOf = (action: ActionReceipt) =>
  action.state === "succeeded"
    ? applyResults(action.result).flatMap((result) => result.native.receipts)
    : [];

/** Counts and the common artifact parent, straight from the host result. */
export function applyTally(action: ActionReceipt) {
  const receipts = receiptsOf(action);
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

export function applyOutcome(action: ActionReceipt, families: readonly string[]): Refusal | null {
  if (action.state !== "succeeded") {
    const noDispatch = action.state === "failed" && action.notDispatched === true;
    const reason = "error" in action ? action.error : `families.apply ${action.state}`;
    return refuse(
      noDispatch && !action.steps.length ? "not-ready" : "failed",
      `${noDispatch ? "nothing ran" : "effects unproven"}: ${families.join(", ")} (${reason})`,
    );
  }
  const receipts = receiptsOf(action);
  const applied = receipts.filter((receipt) => receipt.success).length;
  const failed = receipts
    .filter((receipt) => !receipt.success)
    .map(
      (receipt) =>
        `${receipt.familyName} (${receipt.error || receipt.errors.join(", ") || "no reason given"})`,
    );
  return failed.length
    ? refuse(
        applied ? "partial" : "failed",
        `${applied ? `partly applied: ${applied} written, ${families.length - applied} refused` : "failed in Revit: nothing changed"}: ${failed.join("; ")}`,
      )
    : null;
}
