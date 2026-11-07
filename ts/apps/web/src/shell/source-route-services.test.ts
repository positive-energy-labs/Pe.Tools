import { expect, test, vi } from "vite-plus/test";


import { sourceRouteServices } from "./source-route-services";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingDelivery } from "./source-contract";
import type { ResolvedRead } from "../../../../packages/agent-contracts/src/route-kernel-environment";



test("ordinary sources receive admitted args and an empty Page; stale completions stay stale", async () => {
  const open = vi.fn((ctx, deliver) => {
    expect(ctx.page).toEqual({});
    expect(ctx.args).toEqual({ scene: "saved" });
    deliver({ kind: "complete", value: 1, revision: 1, fresh: false });
  });
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(
    issuer.scope({ target: { kind: "host" }, work: null }),
    "saved",
    1,
  );
  if (!attempt.ok) throw Error(attempt.reason);
  const services = sourceRouteServices({ saved: { kind: "use", open } });
  const request = {
    key: { op: "saved", sortedKeyInput: '{"scene":"saved"}', freshnessGeneration: 1 },
  } as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const deliver = vi.fn();
  const release = services.readings.subscribe(request, attempt.value, deliver);
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({ status: "unavailable", current: false, reason: "Reading is stale" }),
  );
  release();
  read.release();
});

import { commands, actionReceiptSchema } from "@pe/agent-contracts";
import * as actions from "../../../../packages/mcps/src/shared/takeoff-action-client";
const previewTarget = {
  kind: "document" as const,
  ref: { session: "preview-session", openId: "preview-document" },
};
const previewInput = {
  work: {
    key: { route: "families", binding: "open" as const, target: null, open: previewTarget.ref },
    revision: 7,
  },
};
function previewReceipt(key: string, input: unknown, result: unknown) {
  const receipt = actionReceiptSchema.parse({
    id: "preview-receipt",
    key,
    input,
    target: previewTarget,
    state: "succeeded",
    result,
    caller: { kind: "human", via: "local" },
    basis: null,
    steps: [],
    prepared: { state: "unprepared" },
    recovery: [],
    startedAt: "2026-11-03T00:00:00Z",
  });
  if (receipt.state !== "succeeded") throw Error("Invalid test receipt");
  return receipt;
}

function openPreview(
  key: "ducts.plan-losses" | "families.apply.preview",
  input = previewInput,
) {
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(
    issuer.scope({ target: previewTarget, work: input.work.key }),
    "preview",
    1,
  );
  if (!attempt.ok) throw Error(attempt.reason);
  const services = sourceRouteServices({});
  const request = {
    key: { op: key, sortedKeyInput: JSON.stringify(input), freshnessGeneration: 1 },
    output: commands[key].result,
  } as unknown as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const deliver = vi.fn();
  const release = services.readings.subscribe(request, attempt.value, deliver);
  return {
    read,
    deliver,
    close() {
      release();
      read.release();
    },
  };
}







test("undecodable preview retains receipt and released preview cannot deliver", async () => {
  const row = previewReceipt("families.apply.preview", previewInput, { previewOnly: false });
  const submit = vi.spyOn(actions, "submitAction").mockResolvedValue(row);
  const f = openPreview("families.apply.preview");
  try {
    await vi.waitFor(() =>
      expect(f.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", receipt: row }),
      ),
    );
    const retired = openPreview("families.apply.preview");
    retired.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(retired.deliver).not.toHaveBeenCalled();
  } finally {
    f.close();
    submit.mockRestore();
  }
});

test("progressive publications stay inspectable but only fresh completion is current", () => {
  let publish!: ReadingDelivery;
  const services = sourceRouteServices({
    progressive: {
      kind: "use",
      open(_, deliver) {
        publish = deliver;
      },
    },
  });
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(
    issuer.scope({ target: { kind: "host" }, work: null }),
    "progressive",
    1,
  );
  if (!attempt.ok) throw Error(attempt.reason);
  const request = {
    key: { op: "progressive", sortedKeyInput: "{}", freshnessGeneration: 1 },
  } as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const delivered = vi.fn();
  const release = services.readings.subscribe(request, attempt.value, delivered);
  const check = (expected: object) => {
    expect(read.read()).toMatchObject(expected);
    expect(delivered).toHaveBeenLastCalledWith(read.read());
  };
  try {
    publish({ kind: "part", value: { records: [1] }, revision: 1 });
    check({ current: false, value: { records: [1] } });
    // Parts already carry the source's accumulated value; never append it again.
    publish({ kind: "part", value: { records: [1, 2] }, revision: 2 });
    check({ current: false, value: { records: [1, 2] } });
    for (const kind of ["stale", "pending"] as const) {
      publish({ kind: "complete", value: { records: [1, 2] }, revision: 3 });
      check({ status: "ready", current: true });
      publish({ kind });
      check({ current: false, value: { records: [1, 2] } });
    }
    publish({ kind: "failure", error: Error("Read failed") });
    check({
      status: "failed",
      current: false,
      value: { records: [1, 2] },
      reason: "Error: Read failed",
    });
    // Cancelled Families reads are retained parts, not a separate publication kind.
    publish({
      kind: "part",
      value: { records: [1, 2], progress: { state: "cancelled" } },
      revision: 4,
    });
    check({ current: false, value: { records: [1, 2], progress: { state: "cancelled" } } });
    publish({ kind: "failure", error: new DOMException("Stopped", "AbortError") });
    check({ status: "failed", current: false, value: { records: [1, 2] } });
    publish({ kind: "complete", value: { records: [3] }, revision: 5, fresh: false });
    check({ current: false, value: { records: [3] } });
    publish({ kind: "complete", value: { records: [4] }, revision: 6 });
    check({ current: true, value: { records: [4] } });
    const calls = delivered.mock.calls.length;
    publish({ kind: "log", value: "diagnostic" });
    expect(delivered).toHaveBeenCalledTimes(calls);
    check({ current: true, value: { records: [4] } });
    release();
    publish({ kind: "part", value: { records: [5] }, revision: 7 });
    expect(delivered).toHaveBeenCalledTimes(calls);
    check({ current: true, value: { records: [4] } });
  } finally {
    release();
    read.release();
  }
});






