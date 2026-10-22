import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import type {
  DuctsReadingEnvelope,
  DuctsSnapshotReading,
  DuctsTablesReading,
} from "@pe/agent-contracts";
import { canonicalDuctsSession, DuctsReadings } from "../src/ducts-readings.ts";
import type { RevitBridge } from "../src/bridge.ts";

const target = { session: "bridge-a", openId: "open-a" };
const snapshot: DuctsSnapshotReading = { kind: "ducts-snapshot", target };
const tables: DuctsTablesReading = {
  kind: "ducts-tables",
  session: target.session,
  ids: ["SD5-9"],
};
const native = (value: unknown = { nodes: [1] }) => ({
  value,
  nativeRequestId: "native-uuid",
  target: { session: target.session, document: "HVAC", documentRef: target },
});
const changed = (owner: DuctsReadings, openId = target.openId) =>
  owner.changed({
    sessionId: target.session,
    kind: "event",
    eventName: "document-changed",
    payloadJson: JSON.stringify({ changedOpenIds: [openId] }),
  });
const pending = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("concurrent clients, unmount, and a later client share one immutable body and original provenance", async () => {
  const owner = new DuctsReadings();
  const frames: DuctsReadingEnvelope[] = [];
  const release = owner.observe(snapshot, (value) => frames.push(value));
  const read = vi.fn(async () => native());
  const [a, b] = await Promise.all([owner.read(snapshot, read), owner.read(snapshot, read)]);
  release();
  const c = await owner.read(snapshot, read);
  expect(a).toBe(b);
  expect(c).toBe(a);
  expect(read).toHaveBeenCalledTimes(1);
  expect(c.nativeRequestId).toBe("native-uuid");
  expect(frames.map((frame) => frame.state)).toEqual(["idle", "loading", "ready"]);
  expect(JSON.stringify(frames)).not.toContain("nodes");
});

test("exact open lifetime and acquisition inputs key the read; property insertion order does not", async () => {
  const owner = new DuctsReadings();
  const read = vi.fn(async () => native());
  const a = { ...snapshot, slots: { fanFlow: "A", terminalFlow: "B" } };
  const b = { ...snapshot, slots: { terminalFlow: "B", fanFlow: "A" } };
  expect(await owner.read(a, read)).toBe(await owner.read(b, read));
  await owner.read({ ...a, labelParameter: "Tag" }, read);
  await owner.read({ ...snapshot, target: { ...target, openId: "open-b" } }, async () => ({
    ...native(),
    target: { ...native().target, documentRef: { ...target, openId: "open-b" } },
  }));
  expect(read).toHaveBeenCalledTimes(2);
});

test("change fences pending success and a follower serializes the replacement; no stale ready frame", async () => {
  const owner = new DuctsReadings();
  const first = pending<ReturnType<typeof native>>();
  const states: DuctsReadingEnvelope[] = [];
  owner.observe(snapshot, (value) => states.push(value));
  const acquire = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementation(async () => native({ nodes: [2] }));
  const old = owner.read(snapshot, acquire);
  const refused = expect(old).rejects.toMatchObject({ statusCode: 409 });
  await Promise.resolve();
  changed(owner);
  const next = owner.read(snapshot, acquire);
  expect(acquire).toHaveBeenCalledTimes(1);
  first.resolve(native());
  await refused;
  expect(JSON.parse((await next).json)).toEqual({ nodes: [2] });
  expect(states.filter((frame) => frame.state === "ready")).toHaveLength(1);
});

test("version retrieval never reacquires a missing or invalidated graph; refresh of one revision coalesces", async () => {
  const owner = new DuctsReadings();
  const read = vi.fn(async () => native());
  const first = await owner.read(snapshot, read);
  expect(await owner.read(snapshot, read, { version: first.version })).toBe(first);
  const [a, b] = await Promise.all([
    owner.read(snapshot, read, { refresh: first.version }),
    owner.read(snapshot, read, { refresh: first.version }),
  ]);
  expect(a).toBe(b);
  expect(a.version).not.toBe(first.version);
  await expect(owner.read(snapshot, read, { version: first.version })).rejects.toMatchObject({
    statusCode: 409,
  });
  changed(owner);
  await expect(owner.read(snapshot, read, { version: a.version })).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(read).toHaveBeenCalledTimes(2);
});

test("tables retain across document changes, but disconnect fences both reads and reconnect reacquires", async () => {
  const owner = new DuctsReadings();
  const read = vi.fn(async () => native());
  const body = await owner.read(tables, read);
  changed(owner);
  expect(await owner.read(tables, read)).toBe(body);
  const running = pending<ReturnType<typeof native>>();
  const old = owner.read(snapshot, () => running.promise);
  const refused = expect(old).rejects.toMatchObject({ statusCode: 409 });
  owner.changed({ kind: "disconnected", sessionId: target.session });
  running.resolve(native());
  await refused;
  await expect(owner.read(tables, read)).rejects.toMatchObject({ statusCode: 409 });
  owner.changed({ kind: "connected", sessionId: target.session });
  expect((await owner.read(tables, read)).version).not.toBe(body.version);
});

test("document close fences only its snapshots and native target mismatch refuses publication", async () => {
  const owner = new DuctsReadings();
  const body = await owner.read(snapshot, async () => native());
  owner.changed({ kind: "state-sync", sessionId: target.session, openDocumentIds: [] });
  await expect(
    owner.read(snapshot, async () => native(), { version: body.version }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    new DuctsReadings().read(snapshot, async () => ({
      ...native(),
      target: { session: "wrong", document: null },
    })),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("entry count and UTF-8 byte budgets evict idle bodies; live bodies are never clipped", async () => {
  const owner = new DuctsReadings({ entries: 1, bytes: 100, idleMs: 900_000 });
  const a = await owner.read(snapshot, async () => native());
  await owner.read(tables, async () => native());
  const read = vi.fn(async () => native());
  await expect(owner.read(snapshot, read, { version: a.version })).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(read).not.toHaveBeenCalled();
  await expect(owner.read(snapshot, async () => native("é".repeat(60)))).rejects.toMatchObject({
    statusCode: 409,
  });
});

test("SDK alias and canonical bridge id resolve to one identity, ambiguity is refused", async () => {
  const bridge = {
    list: Effect.succeed([{ connected: true, sessionId: "bridge-a", sdkSessionId: "dev" }]),
  } as unknown as RevitBridge["Service"];
  expect(await canonicalDuctsSession(bridge, "dev")).toBe(
    await canonicalDuctsSession(bridge, "bridge-a"),
  );
  await expect(
    canonicalDuctsSession(
      {
        list: Effect.succeed([
          { connected: true, sessionId: "a", sdkSessionId: "dev" },
          { connected: true, sessionId: "b", sdkSessionId: "dev" },
        ]),
      } as unknown as RevitBridge["Service"],
      "dev",
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("a silent acquisition reports failure to every subscriber and fences late success without releasing single-flight", async () => {
  vi.useFakeTimers();
  try {
    const owner = new DuctsReadings({ entries: 2, bytes: 1024, idleMs: 1000, waitMs: 120_000 });
    const result = pending<ReturnType<typeof native>>();
    const frames: DuctsReadingEnvelope[] = [];
    owner.observe(snapshot, (value) => frames.push(value));
    const read = vi.fn(() => result.promise);
    const flight = owner.read(snapshot, read);
    const failure = expect(flight).rejects.toMatchObject({ statusCode: 409 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(frames.at(-1)).toMatchObject({
      state: "failed",
      error: expect.stringContaining("no answer"),
    });
    expect(read).toHaveBeenCalledTimes(1);
    result.resolve(native());
    await failure;
    expect(frames.some((frame) => frame.state === "ready")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
