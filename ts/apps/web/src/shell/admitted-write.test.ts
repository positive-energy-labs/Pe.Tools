import { expect, test, vi } from "vite-plus/test";
import type { TimelineEntry } from "./timeline";

import { writeReject } from "./catalog-work-reviews";



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
  expect(writeReject([entry({ kind: "human" })], ["heal"], reject)).toBeNull();
  writeReject([entry({ kind: "human" })], ["heal"], reject, "bound-thread")!.run();
  expect(reject).toHaveBeenCalledWith("bound-thread", "q1");
  expect(writeReject([entry({ kind: "pea", thread: "t" }, "assign")], ["heal"], reject)).toBeNull();
});


