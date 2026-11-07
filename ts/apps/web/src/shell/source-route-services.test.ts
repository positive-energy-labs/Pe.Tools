import { expect, test, vi } from "vite-plus/test";
import type { ResolvedRead } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingDelivery } from "./source-contract";
import { sourceRouteServices } from "./source-route-services";

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
