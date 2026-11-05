import { expect, test, vi } from "vite-plus/test";
import type { TimelineEntry } from "./timeline";
import { writeHeld, writeReject } from "./admitted-chrome";

const seal = {
  requestHash: "h",
  work: { key: "ducts" },
  documentMark: { session: "s", openId: "o", observedSince: 1, changedAt: null },
  incarnation: 1,
  dependencies: "d",
};
const review = (preview: unknown, stale = false) => ({ preview, sentence: "2 Revit targets", rows: ["a", "b"], stale });

test("a sealed plan arms; an unsealed one never arms apply; a stale one disarms with its reason", () => {
  const armed = writeHeld("Heal", review({ previewOnly: true, derivedRequest: {}, seal }));
  expect(armed.held?.word).toBe("Heal · planned 2");
  expect(armed.sealed).toBe(true);
  expect(writeHeld("Heal", review({ previewOnly: true, derivedRequest: {} })).sealed).toBe(false);
  expect(writeHeld("Heal", review({ previewOnly: true, derivedRequest: {}, seal }, true))).toEqual({
    held: null,
    stale: "changed since plan",
    sealed: false,
  });
  expect(writeHeld("Heal", null).held).toBeNull();
});

test("a Read plan never says checked in Revit", () => {
  expect(writeHeld("Heal", review({ previewOnly: true, derivedRequest: {}, seal })).held?.word).not.toMatch(/checked/);
});

test("Reject? answers the thread that ran the receipt, not this page", () => {
  const entry = (caller: object, verb = "heal") =>
    ({
      kind: "receipt",
      at: new Date().toISOString(),
      verb,
      basis: { receipt: { caller } },
      outcome: {
        state: "queued",
        receiptId: "r1",
        consentWindow: { requestId: "q1", deadline: new Date(Date.now() + 30_000).toISOString() },
      },
    }) as unknown as TimelineEntry;
  const reject = vi.fn();
  writeReject([entry({ kind: "pea", thread: "thread-A" })], ["heal"], reject)!.run();
  expect(reject).toHaveBeenCalledWith("thread-A", "q1");
  reject.mockClear();
  writeReject([entry({ kind: "human" })], ["heal"], reject)!.run();
  expect(reject).not.toHaveBeenCalled();
  expect(writeReject([entry({ kind: "pea", thread: "t" }, "assign")], ["heal"], reject)).toBeNull();
});

test("production cells replace rows in the held plan and set its count", () => {
  const cells = [{ key: "a", label: "FC-1 · fan flow", before: null, after: "925 cfm", author: "human" as const }];
  const held = writeHeld("Write to Revit", {
    ...review({ previewOnly: true, derivedRequest: {}, seal }),
    cells,
  }).held!;
  expect(held.cells).toBe(cells);
  expect(held.rows).toBeUndefined();
  expect(held.word).toBe("Write to Revit · planned 1");
});
