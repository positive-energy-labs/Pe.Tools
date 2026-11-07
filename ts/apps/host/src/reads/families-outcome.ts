/** Presentation of the single semantic Families Apply result. */
// TODO: F3a live write proof remains owed: Broan reload refused system compatibility (7524f854-2853-4b41-9929-d551a7d8319e); see .artifacts/accept/u2-f3a/RESULTS.md.
import {
  familyApplyResultSchema,
  writePreviewSchema,
  type ActionReceipt,
} from "@pe/agent-contracts";
type OutcomeReceipt={state:ActionReceipt["state"];steps:readonly unknown[];result?:unknown;notDispatched?:boolean;error?:string};
type Refusal = { code: "not-ready" | "failed" | "partial"; message: string };
const refuse = (code: Refusal["code"], message: string): Refusal => ({ code, message });

export const applyResults = (result: unknown) => {
  if (writePreviewSchema.safeParse(result).success) return [];
  const parsed = familyApplyResultSchema.parse(result);
  return "results" in parsed ? parsed.results : [parsed];
};
const receiptsOf = (action: OutcomeReceipt) =>
  action.state === "succeeded"
    ? applyResults(action.result).flatMap((result) => result.native.receipts)
    : [];

/** Counts and the common artifact parent, straight from the host result. */
export function applyTally(action: OutcomeReceipt) {
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

export function applyOutcome(
  action: OutcomeReceipt,
  families: readonly string[],
): Refusal | null {
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
