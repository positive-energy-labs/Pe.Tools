import type { z } from "zod";
import type {
  AcceptedResult,
  JournalSubmission,
} from "../../../../packages/agent-contracts/src/work-journal-door";

export type CommandResultDecode =
  | { readonly kind: "not-committed" }
  | { readonly kind: "decoded"; readonly value: unknown }
  | {
      readonly kind: "result-undecodable";
      readonly key: string;
      readonly receiptId: string;
      readonly problem: string;
    };

/** Capture the submitted op's schema before observing results. Page changes cannot change it. */
export function commandResultDecoder(
  submission: JournalSubmission,
  entries: Readonly<Record<string, { readonly output: z.ZodType }>>,
) {
  const key = submission.key;
  const schema = entries[key]?.output;
  return (outcome: AcceptedResult): CommandResultDecode => {
    if (outcome.kind !== "accepted-native" || outcome.outcome !== "committed")
      return { kind: "not-committed" };
    const decoded = schema?.safeParse(outcome.result);
    if (!decoded?.success)
      return {
        kind: "result-undecodable",
        key,
        receiptId: outcome.receiptId,
        problem: decoded?.error.message ?? `No output schema for submitted op: ${key}`,
      };
    return { kind: "decoded", value: decoded.data };
  };
}
