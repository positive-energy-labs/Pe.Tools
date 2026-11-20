import { expect, test, vi } from "vite-plus/test";
import { createReadOwnership, type ReadOwnershipPorts } from "../src/reads/read-ownership.ts";
import { admittedRequestIdentity } from "@pe/host-internal/request-identity";
import type { CausalTerminalState } from "@pe/host-internal/request-contracts";

const deferred = <T>() => Promise.withResolvers<T>();
const settled: CausalTerminalState = { kind: "settled", requiredDescendants: [], evidence: [] };
const identity = () =>
  admittedRequestIdentity(
    { kind: "human", via: "local" },
    { bridgeSessionId: "session", openDocumentId: "document" },
  );
const setup = (overrides: Partial<ReadOwnershipPorts> = {}) => {
  const ports: ReadOwnershipPorts = {
    native: vi.fn(async () => {
      throw Error("unused");
    }),
    state: () => settled,
    settle: async () => settled,
    ...overrides,
  };
  const reads = createReadOwnership(ports);
  return { ports, reads, owner: reads.open(identity()) };
};

test("the final consumer signals only the read; submitted write and restoration retain custody", async () => {
  const write = deferred<CausalTerminalState>();
  let state: CausalTerminalState = { kind: "unsettled", requiredDescendants: [], evidence: [] };
  const { reads, owner } = setup({ state: () => state, settle: () => write.promise });
  const read = deferred<string>();
  let signal!: AbortSignal;
  const flight = reads.flight(owner, (s) => {
    signal = s;
    return read.promise;
  });
  const first = flight.join(),
    last = flight.join();
  await Promise.resolve();
  first.release();
  first.release();
  expect(signal.aborted).toBe(false);
  last.release();
  expect(signal.aborted).toBe(true);
  expect(() => flight.join()).toThrow();
  let parentSettled = false;
  const parent = owner.settle().then((value) => {
    parentSettled = true;
    return value;
  });
  read.resolve("read stopped");
  await flight.result;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(parentSettled).toBe(false);
  expect(owner.state().kind).toBe("unsettled");
  // Native terminal observation and restoration complete independently of read cancellation.
  state = settled;
  write.resolve(state);
  expect(await parent).toEqual(settled);
  expect(await flight.settlement).toEqual(settled);
});

test("Stop releases all read leases and closes ordinary admission, but is not terminal evidence", async () => {
  const pending = deferred<void>();
  const unknown: CausalTerminalState = {
    kind: "unsettled",
    requiredDescendants: [],
    evidence: [
      {
        nativeRequestId: "native",
        outcome: "unknown-until-reconciled",
        settlement: "unknown-until-reconciled",
      },
    ],
  };
  const { reads, owner } = setup({ state: () => unknown, settle: async () => unknown });
  let signal!: AbortSignal;
  const flight = reads.flight(owner, (s) => {
    signal = s;
    return pending.promise;
  });
  flight.join();
  flight.join();
  await Promise.resolve();
  await owner.requestStop();
  await owner.requestStop();
  expect(signal.aborted).toBe(true);
  expect(() => reads.flight(owner, async () => {})).toThrow();
  await expect(owner.native("revit.catalog.field-options", { key: "test" })).rejects.toThrow();
  expect(owner.state()).toEqual(unknown);
  pending.resolve();
  expect(await owner.settle()).toEqual(unknown);
});

test("settlement drains reads without cancelling them and preserves the admitted identity", async () => {
  const native = deferred<never>();
  const admitted = identity();
  const runner = vi.fn((..._args: Parameters<ReadOwnershipPorts["native"]>) => native.promise);
  const { reads } = setup({ native: (...args) => runner(...args) });
  const owner = reads.open(admitted);
  const result = owner.native("revit.catalog.field-options", { key: "domain" });
  await Promise.resolve();
  expect(runner.mock.calls[0]?.[0]).toBe(admitted);
  const signal = runner.mock.calls[0]![3];
  const settlement = owner.settle();
  expect(signal.aborted).toBe(false);
  expect(owner.state().kind).toBe("unsettled");
  native.reject(Error("failed read"));
  await expect(result).rejects.toThrow("failed read");
  expect(await settlement).toEqual(settled);
});

test("a foreign owner cannot open a flight", () => {
  const { owner } = setup();
  const { reads } = setup();
  expect(() => reads.flight(owner, async () => {})).toThrow("another lifetime service");
});
