import { testJournal } from "./effect-test.ts";
import { expect, test, vi } from "vite-plus/test";
import type { ActionReceipt, Machine } from "@pe/agent-contracts";
import type {
  ControlledPending,
  DocListResult,
  ObservedActive,
  SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";
import {
  machineSources,
  readMachineSession,
  unavailableShare,
  type AttachmentRead,
  type HeldTarget,
} from "../src/machine.ts";
import { machineOwner, settle, type PromiseMachineSources } from "./effect-test.ts";
import type { Providers } from "../src/harness/providers.ts";
import { unreadLeg } from "../src/update-reader.ts";
import { planAcquisition } from "../src/acquisition.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { sdkBinary, sdkCommand } from "./sdk-replay.ts";
import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stateDirectory } from "@pe/host-contracts/service-identity";

/** Effect yields on setImmediate: only the clock and its timers are faked, or no fiber ever resumes. */
const FAKE_CLOCK: { toFake: ("setTimeout" | "clearTimeout" | "Date")[] } = {
  toFake: ["setTimeout", "clearTimeout", "Date"],
};
const sdkRun = vi.hoisted(() => vi.fn<(args: readonly string[]) => Promise<string>>());
vi.mock("../src/session-route.ts", async (original) => {
  const real = await original<typeof import("../src/session-route.ts")>();
  const { Effect } = await import("effect");
  return {
    ...real,
    runPeRevitCli: (args: readonly string[]) => Effect.tryPromise(() => sdkRun(args)),
  };
});

const row: ObservedActive = {
  case: "observed-active",
  execution: { allowed: true, code: null, detail: null },
  year: 2025,
  observedAtUtc: "2026-10-09T00:00:00Z",
  process: { pid: 42, processStartUtc: "2026-10-09T00:00:00.1230000Z", executable: "Revit.exe" },
  shape: {
    payload: "installed",
    purpose: "interactive",
    reload: "none",
    posture: "foreground",
    quarantine: false,
  },
  bridge: { bridge: "answering", sessionDescriptor: null },
};
const attached: AttachmentRead = {
  session: "product-open",
  pid: 42,
  processStartUtcUnixMs: Date.parse(row.process.processStartUtc),
  documentIdentity: "sdk-open-v1",
  documents: [
    {
      session: "product-open",
      openId: "product-id",
      title: "Tower.rvt",
      address: null,
      isFamilyDocument: false,
      isActive: true,
    },
  ],
};
const docs: DocListResult = {
  state: "ok",
  documents: [
    {
      sessionId: "sdk-id",
      openId: "sdk-open",
      title: "Model",
      path: null,
      isModified: false,
      isActive: true,
      isFamily: false,
      window: null,
      isWorkshared: null,
      isDetached: null,
      isCloud: null,
      centralPath: null,
      region: null,
      projectGuid: null,
      modelGuid: null,
    },
  ],
};

function fixture(options?: import("../src/machine.ts").MachineOptions) {
  const update = {
    plan: null,
    receipt: null,
    requestId: null,
    admittedPlanId: null,
    planLeg: unreadLeg(),
    receiptLeg: unreadLeg(),
    automatic: true,
  };
  const sources: PromiseMachineSources = {
    actions: vi.fn(async (): Promise<readonly ActionReceipt[]> => []),
    host: vi.fn(async () => ({
      serviceName: "host",
      instanceId: "this-launch",
      version: "0.7.0",
      payload: "installed" as const,
      process: { pid: 123, processStartUtc: row.process.processStartUtc },
      port: 5180,
      startedBy: null,
      autostart: null,
      redirectionTrust: null,
      sourceRoot: null,
      uptimeSeconds: 5,
      canonicalUrl: "http://127.0.0.1:5180",
    })),
    peers: vi.fn(async () => []),
    sessions: vi.fn(async (): Promise<readonly SessionObservation[]> => [row]),
    documents: vi.fn(async () => docs),
    holdings: vi.fn(async () => null),
    attachments: vi.fn(async () => [attached]),
    years: vi.fn(async () => [2025]),
    providers: vi.fn(async () => ({
      providers: [
        {
          id: "codex",
          harness: "codex" as const,
          name: "Codex",
          auth: { kind: "subscription" as const },
          readiness: { state: "ready" as const },
          models: [],
          traits: [],
          probedAt: null,
        },
      ],
    })),
    update: {
      automaticPending: () => false,
      announce: vi.fn(),
      setAutomatic: vi.fn(),
      current: () => update,
      refresh: vi.fn(async () => update),
      apply: vi.fn(async () => update),
    },
    share: unavailableShare,
    subscribe: vi.fn(() => vi.fn()),
    targets: {
      targets: vi.fn((): readonly HeldTarget[] => []),
      subscribe: vi.fn(() => vi.fn()),
    },
  };
  return { sources, machine: machineOwner(sources, { periodMs: 60_000, ...options }) };
}

test("kept years never hold up a census and survive a stalled check until it recovers", async () => {
  const root = stateFixture(await mkdtemp(join(tmpdir(), "pe-kept-years-")));
  const yearsState = stateDirectory(root.machine, "host", "test-host");
  const now = "2026-11-19T00:00:00.000Z";
  mkdirSync(yearsState.path, { recursive: true });
  writeFileSync(join(yearsState.path, "revit-years.json"), "{damaged");
  const first = fixture({ yearsState, now: () => now });
  expect(first.machine.current().revit.years).toBeNull();
  await first.machine.refresh();

  const second = fixture({ yearsState });
  const waiting = Promise.withResolvers<readonly number[]>();
  vi.mocked(second.sources.years).mockReturnValue(waiting.promise);
  const received: Machine[] = [];
  const stop = second.machine.observe((value) => received.push(value));
  try {
    expect(received[0]).toMatchObject({ revit: { years: [2025] }, legs: { years: { observedAtUtc: now, attemptedAtUtc: null } } });
    const beforeDoctor = await Promise.race([
      second.machine.refresh(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    expect(beforeDoctor).toMatchObject({
      revit: { years: [2025], sessions: [expect.anything()] },
      legs: { years: { observedAtUtc: now } },
    });
    expect((await second.machine.refresh()).revit.years).toEqual([2025]);
    expect(second.sources.years).toHaveBeenCalledTimes(1);
    waiting.reject(Error("SDK timed out"));
    await vi.waitFor(() => expect(received.at(-1)?.legs.years?.error).toContain("timed out"));
    expect(received.at(-1)?.revit.years).toEqual([2025]);
    vi.mocked(second.sources.years).mockResolvedValue([2026]);
    await second.machine.refresh();
    await vi.waitFor(() => expect(received.at(-1)?.revit.years).toEqual([2026]));
  } finally {
    waiting.resolve([]);
    stop();
  }
  expect(fixture({ yearsState }).machine.current().revit.years).toEqual([2026]);
});

test("a stalled observed-document leg publishes unknown at the Machine deadline", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  vi.mocked(f.sources.documents).mockReturnValue(new Promise(() => {}));
  let value: Machine | undefined;
  try {
    void f.machine.refresh().then((reading) => {
      value = reading;
    });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(value?.revit.sessions?.[0]).toMatchObject({
      whose: "you",
      documents: null,
      documentsLeg: { observedAtUtc: null, error: expect.stringContaining("leg exceeded") },
    });
  } finally {
    vi.useRealTimers();
  }
});

test("only an answering Revit in the SDK execution boundary is asked for holdings", async () => {
  const fault = vi.fn();
  const f = fixture({ fault });
  const foreign: ObservedActive = {
    ...row, process: { ...row.process, pid: 43 },
    execution: { allowed: false, code: "session.no-match", detail: "Outside this command's execution boundary" },
  };
  const starting: ControlledPending = {
    case: "controlled-pending", id: "starting", detail: "Bridge has not registered",
    execution: row.execution, year: row.year, observedAtUtc: row.observedAtUtc,
    shape: row.shape, origin: "cli", project: null, worktree: "C:/checkout",
    receipt: { payload: "installed", generationRoot: "C:/revit", receiptPath: "C:/revit/session.json" },
    attempt: { attempt: "launched", process: { ...row.process, pid: 44 }, bridge: { bridge: "missing-endpoint" } },
  };
  vi.mocked(f.sources.sessions).mockResolvedValue([foreign, starting, row]);
  vi.mocked(f.sources.holdings).mockRejectedValue(Error("holdings decoder failed"));
  const result = await f.machine.refresh();
  expect(f.sources.holdings).toHaveBeenCalledExactlyOnceWith(row.process);
  expect(f.sources.documents).toHaveBeenCalledExactlyOnceWith(row.process);
  expect(result.revit.sessions?.map((entry) => entry.holdingsLeg.error)).toEqual([
    null, null, expect.stringContaining("holdings decoder failed"),
  ]);
  expect(fault).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ leg: "holdings", kind: "error" }));
});

test("lifecycle gets the exact document census while years and holdings are still waiting", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  vi.mocked(f.sources.years).mockReturnValue(new Promise(() => {}));
  vi.mocked(f.sources.holdings).mockReturnValue(new Promise(() => {}));
  const result = readMachineSession(row.process).then(
    (value) => ({ value }), (error: unknown) => ({ error }),
  );
  try {
    await vi.advanceTimersByTimeAsync(15_001);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await result).toMatchObject({ value: { documents: docs.documents } });
    expect(f.sources.years).not.toHaveBeenCalled();
    expect(f.sources.holdings).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("a stuck document census refuses with a next step before the machine deadline", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  vi.mocked(f.sources.documents).mockReturnValue(new Promise(() => {}));
  let error: unknown;
  void readMachineSession(row.process).catch((caught: unknown) => { error = caught; });
  try {
    await vi.advanceTimersByTimeAsync(3_001);
    expect(error).toMatchObject({ message: expect.stringContaining("Switch to Revit") });
  } finally {
    vi.useRealTimers();
  }
});

/** A Pea acquisition receipt as instances-actions records it: intent first, then its steps. */
function acquiring(process: { pid: number; processStartUtc: string }): ActionReceipt {
  const start = { year: "2025", owner: "pea", addins: "on" } as const;
  const intent = planAcquisition(
    "launch",
    "C:/pea-work",
    { kind: "create", year: "2025" },
    { source: "C:/Tower.rvt", into: { start } },
    false,
  );
  const work = (intent.document!.origin as { work: string }).work;
  const step = (key: string, result: unknown) => ({
    id: key,
    kind: "native",
    key,
    input: {},
    state: "succeeded",
    result,
  });
  return {
    id: "launch",
    key: "instances.open",
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    effects: [],
    consumes: [],
    claims: [],
    state: "succeeded",
    target: { kind: "host" },
    input: { source: "C:/Tower.rvt", into: { start } },
    steps: [
      step("instances.open.start", { session: { process } }),
      step("instances.open", { document: { openId: "product-id", path: work } }),
    ],
    prepared: { state: "ready", value: { target: null, acquisition: intent } },
    recovery: [],
    startedAt: row.observedAtUtc,
    result: null,
  } as ActionReceipt;
}

test("automatic update requires two continuous Revit-free minutes and waits for Pea", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  let busy = false;
  const machine = machineOwner(f.sources, {
    automaticUpdates: { peaActive: () => busy },
  });
  const plan = { planId: "idle-plan", available: true, blockers: [], revits: [] };
  Object.assign(f.sources.update.current(), { plan });
  vi.mocked(f.sources.sessions).mockResolvedValue([]);
  vi.mocked(f.sources.attachments).mockResolvedValue([]);
  try {
    await machine.refresh();
    vi.advanceTimersByTime(119_999);
    await machine.refresh();
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    vi.mocked(f.sources.sessions).mockResolvedValue([row]);
    await machine.refresh();
    vi.mocked(f.sources.sessions).mockResolvedValue([]);
    await machine.refresh();
    vi.advanceTimersByTime(120_000);
    busy = true;
    await machine.refresh();
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    busy = false;
    await machine.refresh();
    expect(f.sources.update.apply).toHaveBeenCalledExactlyOnceWith("idle-plan", true);
  } finally {
    vi.useRealTimers();
  }
});

test("failed absence observations reset the automatic wait and a Pea turn starting during recheck blocks admission", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  let busy = false;
  const machine = machineOwner(f.sources, {
    automaticUpdates: { peaActive: () => busy },
  });
  Object.assign(f.sources.update.current(), {
    plan: { planId: "idle-plan", available: true, blockers: [], revits: [] },
  });
  vi.mocked(f.sources.sessions).mockResolvedValue([]);
  vi.mocked(f.sources.attachments).mockResolvedValue([]);
  try {
    await machine.refresh();
    vi.advanceTimersByTime(120_000);
    vi.mocked(f.sources.attachments).mockRejectedValueOnce(Error("attachment observation failed"));
    await machine.refresh();
    await machine.refresh();
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120_000);
    vi.mocked(f.sources.sessions).mockRejectedValueOnce(Error("census failed"));
    await machine.refresh();
    await machine.refresh();
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    vi.mocked(f.sources.update.refresh).mockImplementation(async (feed) => {
      if (feed) busy = true;
      return f.sources.update.current();
    });
    vi.advanceTimersByTime(120_000);
    await machine.refresh();
    expect(busy).toBe(true);
    expect(f.sources.update.apply).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("unread observed documents remain unknown and a reused pid cannot classify an orphan socket", async () => {
  const f = fixture();
  try {
    vi.mocked(f.sources.documents).mockRejectedValue(Error("cannot inspect"));
    const reused = { ...attached, processStartUtcUnixMs: attached.processStartUtcUnixMs! + 1 };
    vi.mocked(f.sources.attachments).mockResolvedValue([reused]);
    const value = await f.machine.refresh();
    expect(value.revit.sessions).toHaveLength(1);
    expect(value.revit.sessions?.[0]).toMatchObject({ row, attachment: null, documents: null });
    expect(value.revit.unclassifiedAttachments).toEqual([
      { ...reused, documents: [{ ...reused.documents![0]!, access: { kind: "read" } }] },
    ]);
  } finally {
  }
});

test("SDK adapter uses the all-row census and pid document read, refusing a different incarnation", async () => {
  const f = fixture();
  const envelope = (result: unknown, resolved: unknown = null, diagnostics: unknown[] = []) =>
    JSON.stringify({
      result,
      resolved,
      exitCode: 0,
      diagnostics,
      binary: sdkBinary,
      command: sdkCommand,
      nextSteps: [],
      guide: "session",
      related: [],
    });
  const sources = machineSources(testJournal(), undefined, {} as Providers, f.sources.update);
  try {
    sdkRun.mockResolvedValueOnce(envelope({ sessions: [row], processReadErrors: [] }));
    expect(await settle(sources.sessions())).toEqual([row]);
    expect(sdkRun).toHaveBeenLastCalledWith(["session", "list", "--all", "--json"]);
    sdkRun.mockResolvedValueOnce(envelope({ sessions: [row], processReadErrors: [] }));
    expect(await settle(sources.sessions(row.process.pid))).toEqual([row]);
    expect(sdkRun).toHaveBeenLastCalledWith(["session", "list", "--pid", "42", "--json"]);
    sdkRun.mockResolvedValueOnce(envelope(docs, row.process));
    expect(await settle(sources.documents(row.process))).toEqual(docs);
    expect(sdkRun).toHaveBeenLastCalledWith(["doc", "list", "--pid", "42", "--json"]);
    sdkRun.mockResolvedValueOnce(
      envelope(docs, { ...row.process, processStartUtc: "a-new-process" }),
    );
    await expect(settle(sources.documents(row.process))).rejects.toThrow("different process incarnation");
    sdkRun.mockResolvedValueOnce(envelope(
      { state: "ok", documents: [] }, row.process,
      [{ code: "doc.bridge-unreachable", detail: "bridge did not answer" }],
    ));
    await expect(settle(sources.documents(row.process))).rejects.toThrow("incomplete document census");
    const holdings = [
      {
        openId: "sdk-open",
        title: "Model",
        holdings: {
          empty: false,
          unsaved: true,
          workshared: false,
          savedNotSynced: null,
          elements: [],
          worksets: [],
        },
      },
    ];
    sdkRun.mockResolvedValueOnce(envelope({ state: "ok", documents: holdings }, row.process));
    expect(await settle(sources.holdings(row.process))).toEqual(holdings);
    expect(sdkRun).toHaveBeenLastCalledWith(["doc", "list", "--pid", "42", "--holdings", "--json"]);
    sdkRun.mockResolvedValueOnce(envelope({ state: "ok", documents: null }, row.process));
    expect(await settle(sources.holdings(row.process))).toBeNull();
    sdkRun.mockResolvedValueOnce(envelope({ state: "ok", documents: [] }, row.process));
    expect(await settle(sources.holdings(row.process))).toEqual([]);
    sdkRun.mockResolvedValueOnce(
      envelope({ state: "ok", documents: holdings }, { ...row.process, processStartUtc: "new" }),
    );
    await expect(settle(sources.holdings(row.process))).rejects.toThrow("different process incarnation");
  } finally {
    sdkRun.mockReset();
  }
});

test("SDK process read errors fail the real census adapter and restart the full automatic wait", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  const adapter = machineSources(testJournal(), undefined, {} as Providers, f.sources.update);
  const machine = machineOwner(
    { ...f.sources, sessions: () => settle(adapter.sessions()) },
    {
      automaticUpdates: { peaActive: () => false },
    },
  );
  const census = (processReadErrors: unknown[] = []) =>
    JSON.stringify({
      result: { sessions: [], processReadErrors },
      exitCode: 0,
      diagnostics: [],
      resolved: {},
      binary: sdkBinary,
      command: sdkCommand,
      nextSteps: [],
      guide: "session",
      related: [],
    });
  Object.assign(f.sources.update.current(), {
    plan: { planId: "idle-plan", available: true, blockers: [], revits: [] },
  });
  vi.mocked(f.sources.attachments).mockResolvedValue([]);
  sdkRun.mockResolvedValue(census());
  try {
    await machine.refresh();
    vi.advanceTimersByTime(120_000);
    sdkRun.mockResolvedValueOnce(
      census([
        { candidatePid: 42, detail: "process access denied", observedAtUtc: row.observedAtUtc },
      ]),
    );
    const failed = await machine.refresh();
    expect(failed.legs.sessions?.error).toContain("process access denied");
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    await machine.refresh();
    vi.advanceTimersByTime(119_999);
    await machine.refresh();
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await machine.refresh();
    expect(f.sources.update.apply).toHaveBeenCalledExactlyOnceWith("idle-plan", true);
  } finally {
    sdkRun.mockReset();
    vi.useRealTimers();
  }
});

/* ── Per-document access: the only place the browser learns who may write ───────────────── */

const targetHeld = (): HeldTarget => ({
  thread: "t1",
  title: "Retag level 2",
  lifetime: { session: "product-open", openId: "product-id" },
});
/** A controlled Revit whose SDK census natively certifies each document's independence. */
const controlled = (documents: { openId: string; isWorkshared: boolean | null }[]) =>
  ({
    ...row,
    case: "controlled-active",
    id: "dev",
    receipt: { receiptPath: "C:/receipts/dev.json" },
    bridge: {
      bridge: "ready",
      documents: documents.map((doc) => ({ ...doc, isDetached: false, title: doc.openId })),
    },
  }) as unknown as SessionObservation;
const accessesAt = async (
  targets: readonly HeldTarget[],
  at: string,
  acquired?: { sdk: { openId: string; isWorkshared: boolean | null }[]; products?: string[] },
  documentIdentity: AttachmentRead["documentIdentity"] = "sdk-open-v1",
) => {
  const f = fixture();
  vi.mocked(f.sources.targets.targets).mockReturnValue(targets);
  vi.mocked(f.sources.attachments).mockResolvedValue([{ ...attached, documentIdentity }]);
  if (acquired) {
    vi.mocked(f.sources.actions).mockResolvedValue([acquiring(row.process)]);
    vi.mocked(f.sources.sessions).mockResolvedValue([controlled(acquired.sdk)]);
    vi.mocked(f.sources.attachments).mockResolvedValue([
      {
        ...attached,
        documentIdentity,
        documents: (acquired.products ?? ["product-id"]).map((openId) => ({
          ...attached.documents![0]!,
          openId,
        })),
      },
    ]);
  }
  const machine = machineOwner(f.sources, { periodMs: 60_000, now: () => at });
  try {
    return (await machine.refresh()).revit.sessions![0]!.attachment!.documents!.map(
      (doc) => doc.access,
    );
  } finally {
  }
};
const accessAt = async (targets: readonly HeldTarget[], at: string) =>
  (await accessesAt(targets, at))[0];

test("access: one SDK id joins the acquisition and a human-added target; without the identity marker both stay read", async () => {
  const at = "2026-10-12T12:30:00.000Z";
  // The SDK doc-list id and the bridge openId are the same string: SDK beta.202's one authority.
  const sdk = [{ openId: "product-id", isWorkshared: false }];
  expect(await accessesAt([], at, { sdk })).toEqual([{ kind: "pea", acquisition: "launch" }]);
  expect(await accessAt([targetHeld()], at)).toEqual({
    kind: "target",
    thread: "t1",
    label: "Retag level 2",
  });
  // A payload that did not attest SDK identity: equal strings prove nothing, nothing writes.
  expect(await accessesAt([], at, { sdk }, null)).toEqual([{ kind: "read" }]);
  expect(await accessesAt([targetHeld()], at, undefined, null)).toEqual([{ kind: "read" }]);
});

test("U-02: an automatic apply slower than the leg deadline is not a failed read and is not re-admitted", async () => {
  vi.useFakeTimers(FAKE_CLOCK);
  const f = fixture();
  const machine = machineOwner(f.sources, { automaticUpdates: { peaActive: () => false } });
  Object.assign(f.sources.update.current(), {
    plan: { planId: "idle-plan", latest: "0.9.0", available: true, blockers: [], revits: [] },
  });
  vi.mocked(f.sources.sessions).mockResolvedValue([]);
  vi.mocked(f.sources.attachments).mockResolvedValue([]);
  vi.mocked(f.sources.update.apply).mockImplementation(() => new Promise(() => {}));
  try {
    await machine.refresh();
    await vi.advanceTimersByTimeAsync(120_000);
    const frame = await machine.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    const later = await machine.refresh();
    expect(frame.legs["automatic-update"]).toBeUndefined();
    expect(later.legs["automatic-update"]).toBeUndefined();
    expect(f.sources.update.apply).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("the machine resource publishes holdings counts while scoped reads retain the canonical ids", async () => {
  const f = fixture();
  vi.mocked(f.sources.holdings).mockResolvedValue([
    {
      openId: "sdk-open",
      title: "Model",
      holdings: {
        elements: Array.from({ length: 100000 }, (_, id) => ({
          id,
          category: "Ducts",
          name: "HELD_SENTINEL",
          changedSinceSync: null,
          requesters: [],
        })),
        worksets: [],
        empty: false,
        savedNotSynced: null,
        unsaved: false,
        workshared: true,
      },
    },
  ]);
  try {
    await f.machine.refresh();
    let snapshot: unknown;
    const release = hostResourceObserver(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      f.machine,
    )({ kind: "machine" }, (frame) => {
      snapshot = frame;
    });
    try {
      const json = JSON.stringify(snapshot);
      expect(json).not.toContain("HELD_SENTINEL");
      expect(JSON.parse(json).value.revit.sessions[0].holdings[0].holdings.elementCount).toBe(
        100000,
      );
      expect(f.machine.current().revit.sessions![0]!.holdings![0]!.holdings.elements).toHaveLength(
        100000,
      );
    } finally {
      release();
    }
  } finally {
  }
});
