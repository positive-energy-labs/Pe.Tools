/** Each family row's verdict on the /families matrix: its apply receipt, else its plan row. */
import type { FfReceipt } from "@pe/agent-contracts";

import type { Verdict } from "#/components/master-table/model";
import type { PlanSheet, PlanEntry } from "#/route";

/**
 * Keyed by family NAME (ruling, msg-authority-family-identity): Revit reissues an applied family's
 * element id on reload, so an id-keyed receipt or plan row would find nothing on the next reading.
 * A plan row's `id` is its family name.
 */
export function familyVerdicts(
  plan: PlanSheet | null,
  receipts: readonly FfReceipt[],
  excluded: ReadonlySet<string>,
): (row: { familyName: string }) => Verdict {
  const planByName = new Map<string, PlanEntry>();
  for (const entry of plan?.entries ?? []) planByName.set(entry.id, entry);
  const receiptByName = new Map<string, FfReceipt>();
  for (const entry of receipts) receiptByName.set(entry.familyName, entry);
  return ({ familyName }): Verdict => {
    const done = receiptByName.get(familyName);
    if (done) {
      return done.success
        ? {
            word: done.converged ? "converged" : "residue",
            tone: done.converged ? "done" : "alarm",
            note: `${done.residue.length} change(s) remaining; ${done.errors.length} error(s)`,
          }
        : {
            // A refused write is the one thing on this row asking for a person: the ONE alarm.
            word: "failed",
            tone: "alarm",
            note: done.error ?? "apply failed with no reported reason",
          };
    }
    const entry = planByName.get(familyName);
    if (!plan) {
      return {
        word: "unplanned",
        tone: "mute",
        dim: true,
        note: "no plan compiled yet — the table is scope, not judgment",
      };
    }
    if (!entry) {
      return {
        word: "outside spec",
        tone: "mute",
        dim: true,
        note: "in scope, but the planned spec does not claim this family",
      };
    }
    const flag = entry.flag;
    // Not a warning about the model and not a refusal — a verdict with nothing behind it.
    if (flag) return { word: "no actions", tone: "mute", note: flag };
    return excluded.has(familyName)
      ? {
          word: "excluded",
          tone: "mute",
          dim: true,
          note: "excluded from apply in the decision queue",
        }
      : {
          /* Queued actions are UNSAVED work: nothing has left the page, and caution is the
                 language's staged rank. Deliberately NOT the commit blue — that is the verb's,
                 and a state dot wearing it would spend the one filled blue on a readout. */
          word: "included",
          tone: "caution",
          note: `${entry.actions} action(s) queued`,
        };
  };
}
