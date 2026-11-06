import { workFingerprintSchema } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { expect, test, vi } from "vite-plus/test";
import type { Readings } from "../readings";
import type {
  WorkFeedState,
  WorkScope,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { createWorkFeedClient } from "./work-feed-client";
const key = { binding: "host", route: "note", target: null } as const;
const scope: WorkScope = {
  route: "note",
  fingerprint: workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  key,
  target: null,
  subject: null,
};
type Frame = Parameters<Parameters<Readings["subscribe"]>[1]>[0];
const ack = (revision: number) =>
  ({
    kind: "event",
    key: "acks",
    value: {
      key,
      kind: "apply",
      by: "human",
      press: `p${revision}`,
      base: revision - 1,
      revision,
      patches: [{ path: ["amount"], value: revision }],
      inverse: [{ path: ["amount"], value: revision - 1 }],
      undoable: true,
    },
  }) as Frame;
const snapshot = (revision: number) =>
  ({
    kind: "snapshot",
    key: "work",
    value: {
      handle: { key, revision },
      revision,
      doc: { amount: revision },
      history: { from: revision + 1, acks: [] },
    },
  }) as Frame;
function harness(replay: Frame[] = []) {
  const listeners = new Map<string, (frame: Frame) => void>();
  const stops = [vi.fn(), vi.fn()];
  const order: string[] = [];
  const source: Readings = {
    subscribe(request, listener) {
      order.push(request.kind);
      listeners.set(request.kind, listener);
      if (request.kind === "work-acks") replay.forEach(listener);
      return stops[request.kind === "work-acks" ? 0 : 1]!;
    },
    dirty: vi.fn(),
  };
  const values: WorkFeedState[] = [];
  const end = vi.fn();
  const unsubscribe = createWorkFeedClient(source)
    .open(scope)
    .subscribe((value) => values.push(value), end);
  return {
    values,
    end,
    stops,
    order,
    source,
    unsubscribe,
    emit: (kind: string, frame: Frame) => listeners.get(kind)!(frame),
  };
}
test("absent Work stays pending without failing or releasing feeds, then accepts current Work", () => {
  const h = harness();
  h.emit("work-acks", { kind: "snapshot", key: "acks", value: null });
  h.emit("work", { kind: "snapshot", key: "work", value: null });
  expect(h.values.at(-1)).toEqual({ kind: "pending" });
  expect(h.values.some((state) => state.kind === "failed")).toBe(false);
  expect(h.end).not.toHaveBeenCalled();
  expect(h.stops.every((stop) => stop.mock.calls.length === 0)).toBe(true);
  h.emit("work", snapshot(0));
  expect(h.values.at(-1)).toMatchObject({ kind: "ready", snapshot: { revision: 0, value: { amount: 0 } } });
  h.unsubscribe();
  expect(h.stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});

test("subscribe before snapshot, buffer and sort acks, drop revisions covered by snapshot", () => {
  const h = harness([ack(3), ack(1), ack(2)]);
  expect(h.order).toEqual(["work-acks", "work"]);
  expect(h.values).toEqual([{ kind: "pending" }]);
  const frame = snapshot(1) as Extract<Frame, { kind: "snapshot" }>;
  h.emit("work", {
    ...frame,
    value: {
      ...(frame.value as object),
      history: { from: 1, acks: [(ack(1) as Extract<Frame, { kind: "event" }>).value] },
    },
  });
  expect(h.values.find((v) => v.kind === "ready")).toMatchObject({
    history: { from: 1, acks: [{ revision: 1 }] },
  });
  expect(h.values.map((value) => value.kind)).toEqual(["pending", "ready", "ack", "ack"]);
  expect(
    h.values.filter((value) => value.kind === "ack").map((value) => value.ack.revision),
  ).toEqual([2, 3]);
  h.emit("work-acks", ack(2));
  expect(h.values).toHaveLength(4);
  h.unsubscribe();
  h.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
});
test("gap emits pending and fresh ready in band, keeps the original ack subscription", () => {
  const h = harness([ack(4)]);
  h.emit("work", snapshot(1));
  expect(h.values.slice(-2)).toEqual([{ kind: "gap", from: 2, to: 4 }, { kind: "pending" }]);
  expect(h.source.dirty).toHaveBeenCalledOnce();
  h.emit("work-acks", ack(5));
  h.emit("work", snapshot(3));
  expect(h.values.map((value) => value.kind)).toEqual([
    "pending",
    "ready",
    "gap",
    "pending",
    "ready",
    "ack",
    "ack",
  ]);
  expect(h.order).toEqual(["work-acks", "work"]);
  h.emit("work-acks", ack(7));
  expect(h.values.slice(-2)).toEqual([{ kind: "gap", from: 6, to: 7 }, { kind: "pending" }]);
  h.unsubscribe();
});
test.each(["work", "work-acks"])("%s failure is terminal and releases both observers", (kind) => {
  const h = harness();
  h.emit(kind, { kind: "failure", key: "failed", error: "gone" });
  h.emit("work", snapshot(0));
  h.emit("work-acks", ack(1));
  expect(h.values.map((value) => value.kind)).toEqual(["pending", "failed"]);
  expect(h.end).toHaveBeenCalledOnce();
  h.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
});
test("synchronous ack subscription failure never acquires a snapshot", () => {
  const h = harness([{ kind: "failure", key: "acks", error: "gone" }]);
  expect(h.order).toEqual(["work-acks"]);
  expect(h.end).toHaveBeenCalledOnce();
  expect(h.stops[0]).toHaveBeenCalledOnce();
  h.unsubscribe();
});
test("fresh snapshot failure and malformed or foreign acknowledgements fail closed", () => {
  for (const [kind, frame] of [
    ["work", { kind: "snapshot", key: "work", value: {} }],
    ["work-acks", { kind: "event", key: "acks", value: {} }],
    [
      "work-acks",
      {
        ...ack(1),
        value: { ...(ack(1) as { value: object }).value, key: { ...key, route: "foreign" } },
      },
    ],
  ] as const) {
    const h = harness();
    h.emit(kind, frame as Frame);
    expect(h.values.at(-1)?.kind).toBe("failed");
    expect(h.end).toHaveBeenCalledOnce();
  }
});
test("synchronous recovery snapshot drains buffered acks without another wire event", () => {
  const h = harness([ack(4), ack(5)]);
  vi.mocked(h.source.dirty).mockImplementation(() => h.emit("work", snapshot(3)));
  h.emit("work", snapshot(1));
  expect(h.values.map((value) => value.kind)).toEqual([
    "pending",
    "ready",
    "gap",
    "pending",
    "ready",
    "ack",
    "ack",
  ]);
  h.unsubscribe();
});
test("a wire gap with no revision bounds fails rather than inventing an interval", () => {
  const h = harness();
  h.emit("work-acks", { kind: "gap", key: "acks", dropped: 2 } as Frame);
  expect(h.values.map((value) => value.kind)).toEqual(["pending", "failed"]);
  expect(h.end).toHaveBeenCalledOnce();
});
test("Work acquisition preserves the admitted source and digest on snapshot and ack subscriptions", () => {
  const requests: unknown[] = [];
  const source: Readings = {
    subscribe: (request) => {
      requests.push(request);
      return () => {};
    },
    dirty: vi.fn(),
  };
  const stop = createWorkFeedClient(source)
    .open(scope)
    .subscribe(
      () => {},
      () => {},
    );
  expect(requests).toEqual([
    {
      kind: "work-acks",
      work: key,
      admission: { routeKey: scope.route, fingerprint: scope.fingerprint },
    },
    { ...key, kind: "work", admission: { routeKey: scope.route, fingerprint: scope.fingerprint } },
  ]);
  stop();
});
test.each([
  {
    kind: "registration-mismatch",
    routeKey: "note",
    expected: workFingerprintSchema.parse(`pod-bytes:${"b".repeat(64)}`),
    received: scope.fingerprint,
  },
  {
    kind: "migration-failed",
    routeKey: "note",
    fromVersion: 1,
    toVersion: 2,
    step: 1,
    message: "upgrade failed",
  },
  { kind: "failed", code: "HostUnavailable", message: "offline" },
] as const)(
  "$kind is terminal and preserved unchanged; later frames cannot revive it",
  (failure) => {
    const h = harness();
    h.emit("work", { kind: "failure", key: "work", error: "refused", failure });
    h.emit("work", snapshot(10));
    h.emit("work-acks", ack(11));
    expect(h.values).toEqual([{ kind: "pending" }, { kind: "failed", failure }]);
    expect(h.end).toHaveBeenCalledOnce();
    expect(h.source.dirty).not.toHaveBeenCalled();
    h.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
  },
);
test("registration mismatch survives client and shell recreation on the same tab transport", () => {
  const h = harness();
  const failure = {
    kind: "registration-mismatch" as const,
    routeKey: "note",
    expected: scope.fingerprint,
    received: scope.fingerprint,
  };
  h.emit("work", { kind: "failure", key: "work", error: "reload", failure });
  const afterRemount: WorkFeedState[] = [];
  const end = vi.fn();
  createWorkFeedClient(h.source)
    .open(scope)
    .subscribe((state) => afterRemount.push(state), end)();
  expect(afterRemount).toEqual([{ kind: "pending" }, { kind: "failed", failure }]);
  expect(h.order).toEqual(["work-acks", "work"]);
  expect(end).toHaveBeenCalledOnce();
});

test("a stale presenter refusal does not poison an up-to-date owner on the same transport", () => {
  const h = harness();
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"c".repeat(64)}`);
  const failure = {
    kind: "registration-mismatch" as const,
    routeKey: scope.route,
    expected: fingerprint,
    received: scope.fingerprint,
  };
  h.emit("work", { kind: "failure", key: "work", error: "reload", failure });
  const values: WorkFeedState[] = [];
  const stop = createWorkFeedClient(h.source)
    .open({ ...scope, fingerprint })
    .subscribe(
      (state) => values.push(state),
      () => {},
    );
  expect(values).toEqual([{ kind: "pending" }]);
  expect(h.order).toEqual(["work-acks", "work", "work-acks", "work"]);
  stop();
});

test("atomic ack-feed acquisition wins the redundant snapshot and delivers the racing write once", () => {
  const h = harness();
  h.emit("work-acks", snapshot(0));
  h.emit("work-acks", ack(1));
  h.emit("work", snapshot(1));
  h.emit("work-acks", ack(1));
  expect(h.values.map((value) => value.kind)).toEqual(["pending", "ready", "ack"]);
  h.unsubscribe();
});
