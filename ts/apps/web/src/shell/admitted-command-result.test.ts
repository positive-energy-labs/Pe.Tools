import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { commandResultDecoder } from "./admitted-command-result";
import type { JournalSubmission } from "../../../../packages/agent-contracts/src/work-journal-door";
const axes = {
  subject: "None",
  touches: ["Metadata"],
  effect: "SessionWrite",
  cost: "Cheap",
  cardinality: "One",
} as const;
const outcome = { kind: "accepted-native", outcome: "committed", receiptId: "receipt" } as const;
const submission = { key: "sent" } as JournalSubmission;

test("decode captures the submission key and schema, not a replacement entry", () => {
  const entries = {
    sent: { input: z.unknown(), output: z.string(), axes },
    other: { input: z.unknown(), output: z.number(), axes },
  };
  const decode = commandResultDecoder(submission, entries);
  entries.sent = entries.other as unknown as typeof entries.sent;
  expect(decode({ ...outcome, result: "original" })).toEqual({
    kind: "decoded",
    value: "original",
  });
  expect(decode({ ...outcome, result: 3 })).toMatchObject({
    kind: "result-undecodable",
    key: "sent",
    receiptId: "receipt",
  });
});

test("missing and malformed output report result-undecodable unless undefined is admitted", () => {
  const decode = (output: z.ZodType) =>
    commandResultDecoder(submission, { sent: { output } });
  expect(decode(z.string())(outcome)).toMatchObject({ kind: "result-undecodable" });
  expect(decode(z.string().optional())(outcome)).toEqual({ kind: "decoded", value: undefined });
  for (const state of [
    "never-dispatched",
    "native-cancel-requested",
    "native-acknowledged",
    "unknown-until-reconciled",
  ] as const)
    expect(
      decode(z.unknown())({ kind: "accepted-native", outcome: state, receiptId: "r" }),
    ).toEqual({ kind: "not-committed" });
  expect(decode(z.unknown())({ kind: "rejected", failure: "failed", problem: "no" })).toEqual({
    kind: "not-committed",
  });
});
