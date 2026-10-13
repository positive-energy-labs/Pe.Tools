import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { hostStatusRoute } from "../src/app.ts";
import type { ActionReceipt, HeadGrant, Machine } from "@pe/agent-contracts";
import type {
  ControlledActive,
  DocListResult,
  ObservedActive,
  SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";
import {
  bridgeAttachments,
  createMachine,
  machineSources,
  processCustody,
  readMachinePeers,
  unavailableShare,
  useHostMachine,
  type AttachmentRead,
  type HeldGrant,
  type MachineSources,
} from "../src/machine.ts";
import type { Providers } from "../src/harness/providers.ts";
import { unreadLeg } from "../src/update-reader.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { planAcquisition } from "../src/acquisition.ts";

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

function fixture() {
  const update = {
    plan: null,
    receipt: null,
    requestId: null,
    admittedPlanId: null,
    planLeg: unreadLeg(),
    receiptLeg: unreadLeg(),
    automatic: true,
  };
  const sources: MachineSources = {
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
      access: { guarded: true },
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
    grants: { grants: vi.fn((): readonly HeldGrant[] => []), subscribe: vi.fn(() => vi.fn()) },
  };
  return { sources, machine: createMachine(sources, { periodMs: 60_000 }) };
}

test("a stalled observed-document leg publishes unknown at the Machine deadline", async () => {
  vi.useFakeTimers();
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
    f.machine.close();
    vi.useRealTimers();
  }
});

/** A Pea acquisition receipt as instances-actions records it: intent first, then its steps. */
function acquiring(
  verb: "start" | "open",
  state: ActionReceipt["state"],
  process: { pid: number; processStartUtc: string },
  stepState: "succeeded" | "running" = "succeeded",
  openId = "product-id",
): ActionReceipt {
  const start = { year: "2025", owner: "pea", addins: "on" } as const;
  const intent = planAcquisition(
    "launch",
    "C:/pea-work",
    { kind: "create", year: "2025" },
    verb === "open" ? { source: "C:/Tower.rvt", into: { start } } : null,
    false,
  );
  const work = verb === "open" ? (intent.document!.origin as { work: string }).work : null;
  const step = (key: string, result: unknown) =>
    stepState === "succeeded"
      ? { id: key, kind: "native", key, input: {}, state: "succeeded", result }
      : { id: key, kind: "native", key, input: {}, state: "running" };
  return {
    kind: "workflow",
    id: "launch",
    key: `instances.${verb}`,
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    state,
    destination: { kind: "host" },
    request: verb === "start" ? start : { source: "C:/Tower.rvt", into: { start } },
    bases: {},
    steps:
      verb === "start"
        ? [step("instances.start", { session: { process } })]
        : [
            step("instances.open.start", { session: { process } }),
            step("instances.open", { document: { openId, path: work } }),
          ],
    preparation: { state: "ready", value: { target: null, acquisition: intent } },
    recovery: [],
    startedAt: row.observedAtUtc,
    publication: { state: "unrequested" },
    ...(state === "succeeded" ? { result: null } : {}),
    ...(state === "failed" ? { error: "failed", status: 409 } : {}),
  } as ActionReceipt;
}

test.each([
  ["start", "succeeded", "succeeded", 42, row.process.processStartUtc, "background", "pea"],
  ["open", "succeeded", "succeeded", 42, row.process.processStartUtc, "background", "pea"],
  // An acquisition stays evidence when the posture changes: background is presentation.
  ["start", "succeeded", "succeeded", 42, row.process.processStartUtc, "foreground", "pea"],
  ["start", "running", "running", 42, row.process.processStartUtc, "background", "you"],
  ["start", "succeeded", "succeeded", 43, row.process.processStartUtc, "background", "you"],
  ["start", "succeeded", "succeeded", 42, "2026-10-09T00:00:01Z", "background", "you"],
] as const)(
  "whose: %s %s, step %s, pid %s start %s posture %s gives %s",
  async (verb, state, stepState, pid, processStartUtc, posture, whose) => {
    const f = fixture();
    const receipt = acquiring(verb, state, { pid, processStartUtc }, stepState);
    vi.mocked(f.sources.sessions).mockResolvedValue([{ ...row, shape: { ...row.shape, posture } }]);
    vi.mocked(f.sources.actions).mockResolvedValue([receipt]);
    try {
      const reading = await f.machine.refresh();
      expect(reading.revit.sessions![0]).toHaveProperty("whose", whose);
    } finally {
      f.machine.close();
    }
  },
);

test("a background row whose launch carried no acquisition intent projects whose you", async () => {
  const f = fixture();
  const legacy = {
    ...acquiring("start", "succeeded", row.process),
    preparation: { state: "unprepared" },
  };
  vi.mocked(f.sources.actions).mockResolvedValue([legacy as ActionReceipt]);
  vi.mocked(f.sources.sessions).mockResolvedValue([
    { ...row, shape: { ...row.shape, posture: "background" } },
  ]);
  try {
    expect((await f.machine.refresh()).revit.sessions![0]).toHaveProperty("whose", "you");
  } finally {
    f.machine.close();
  }
});

test("a background SDK row with no launch receipt projects whose you", async () => {
  const f = fixture();
  vi.mocked(f.sources.sessions).mockResolvedValue([
    { ...row, shape: { ...row.shape, posture: "background" } },
  ]);
  try {
    expect((await f.machine.refresh()).revit.sessions![0]).toHaveProperty("whose", "you");
  } finally {
    f.machine.close();
  }
});

test("receipt recovery ticks independently of the feed and installed-years clocks", async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.machine.refresh();
    vi.advanceTimersByTime(5_000);
    await f.machine.refresh();
    expect(f.sources.update.refresh).toHaveBeenNthCalledWith(2, false);
    expect(f.sources.years).toHaveBeenCalledTimes(1);
  } finally {
    f.machine.close();
    vi.useRealTimers();
  }
});

test("automatic update requires two continuous Revit-free minutes and waits for Pea", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let busy = false;
  const handoff = vi.fn();
  const machine = createMachine(f.sources, {
    automaticUpdates: { peaActive: () => busy, handoff },
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
    machine.close();
    f.machine.close();
    vi.useRealTimers();
  }
});

test("failed absence observations reset the automatic wait and a Pea turn starting during recheck blocks admission", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let busy = false;
  const machine = createMachine(f.sources, {
    automaticUpdates: { peaActive: () => busy, handoff: vi.fn() },
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
    machine.close();
    f.machine.close();
    vi.useRealTimers();
  }
});

test("many SSE subscribers and concurrent refreshes share one census and one owner subscription", async () => {
  const f = fixture();
  const frames: unknown[][] = [[], [], []];
  const observe = hostResourceObserver(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.machine,
  );
  const release = frames.map((lane) => observe({ kind: "machine" }, (frame) => lane.push(frame)));
  try {
    const first = f.machine.refresh();
    expect(f.machine.refresh()).toBe(first);
    const value = await first;
    expect(f.sources.sessions).toHaveBeenCalledTimes(1);
    expect(f.sources.documents).toHaveBeenCalledTimes(1);
    expect(f.sources.update.refresh).toHaveBeenCalledTimes(1);
    expect(f.sources.subscribe).toHaveBeenCalledTimes(1);
    expect(frames.map((lane) => lane.length)).toEqual([1, 1, 1]);
    expect(frames[0]?.[0]).toMatchObject({ kind: "snapshot", value });
    const later: Machine[] = [];
    const unwatch = f.machine.observe((value) => later.push(value));
    expect(later[0]).toBe(value);
    expect(f.sources.sessions).toHaveBeenCalledTimes(1);
    unwatch();
  } finally {
    release.forEach((stop) => stop());
    f.machine.close();
  }
});

test("failed legs keep full confirmed evidence and their original observation time", async () => {
  const f = fixture();
  try {
    const first = await f.machine.refresh();
    vi.mocked(f.sources.sessions).mockRejectedValue(Error("census offline"));
    vi.mocked(f.sources.providers).mockRejectedValue(Error("provider owner offline"));
    const failed = await f.machine.refresh();
    expect(failed.revit.sessions?.[0]?.row).toBe(row);
    expect(failed.revit.sessions).toEqual(first.revit.sessions);
    expect(failed.providers).toBe(first.providers);
    expect(failed.legs.sessions).toMatchObject({
      observedAtUtc: first.legs.sessions?.observedAtUtc,
      error: "Error: census offline",
    });
    expect(failed.legs.providers?.error).toContain("provider owner offline");
    expect(f.sources.documents).toHaveBeenCalledTimes(1);
  } finally {
    f.machine.close();
  }
});

test("raw observed row gets SDK documents with unknown persistence and exact product attachment", async () => {
  const f = fixture();
  try {
    const value = await f.machine.refresh();
    const session = value.revit.sessions?.[0];
    expect(session?.row).toBe(row);
    expect(session?.attachment).toEqual({
      ...attached,
      documents: [{ ...attached.documents![0]!, access: { kind: "read" } }],
    });
    expect(session?.documents).toEqual([{ ...docs.documents[0], persistence: null }]);
    expect(session?.attachment?.documents?.[0]?.openId).toBe("product-id");
    expect(f.sources.documents).toHaveBeenCalledWith(row.process);
    vi.mocked(f.sources.documents).mockRejectedValue(Error("doc timeout"));
    const failed = (await f.machine.refresh()).revit.sessions?.[0];
    expect(failed?.documents).toEqual(session?.documents);
    expect(failed?.documentsLeg).toMatchObject({
      observedAtUtc: session?.documentsLeg.observedAtUtc,
      error: "Error: doc timeout",
    });
  } finally {
    f.machine.close();
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
    f.machine.close();
  }
});

test("peer census preserves dead service records and never exposes their tokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-machine-peers-"));
  const service = join(dir, "state", "service");
  await mkdir(service, { recursive: true });
  const path = join(service, "host-source-dead.json");
  const bytes = JSON.stringify({
    schemaVersion: 3,
    instanceId: "dead",
    pid: 2147483647,
    processStartUtc: row.process.processStartUtc,
    port: 5181,
    version: "dev",
    lane: "dev",
    token: "never-publish",
    sourceRoot: "C:/checkout",
  });
  await writeFile(path, bytes);
  try {
    const peers = await readMachinePeers(dir, "host");
    expect(peers).toMatchObject([
      {
        serviceName: "host-source-dead",
        reachable: false,
        sourceRoot: "C:/checkout",
        url: "http://127.0.0.1:5181",
      },
    ]);
    expect(JSON.stringify(peers)).not.toContain("never-publish");
    expect(await readFile(path, "utf8")).toBe(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SDK adapter uses the all-row census and pid document read, refusing a different incarnation", async () => {
  const f = fixture();
  const envelope = (result: unknown, resolved: unknown = null) =>
    JSON.stringify({
      result,
      resolved,
      exitCode: 0,
      diagnostics: [],
      binary: {},
      command: {},
      nextSteps: [],
      guide: "session",
      related: [],
    });
  const sources = machineSources(undefined, {} as Providers, f.sources.update);
  try {
    sdkRun.mockResolvedValueOnce(envelope({ sessions: [row], processReadErrors: [] }));
    expect(await sources.sessions()).toEqual([row]);
    expect(sdkRun).toHaveBeenLastCalledWith(["session", "list", "--all", "--json"]);
    sdkRun.mockResolvedValueOnce(envelope(docs, row.process));
    expect(await sources.documents(row.process)).toEqual(docs);
    expect(sdkRun).toHaveBeenLastCalledWith(["doc", "list", "--pid", "42", "--json"]);
    sdkRun.mockResolvedValueOnce(
      envelope(docs, { ...row.process, processStartUtc: "a-new-process" }),
    );
    await expect(sources.documents(row.process)).rejects.toThrow("different process incarnation");
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
    expect(await sources.holdings(row.process)).toEqual(holdings);
    expect(sdkRun).toHaveBeenLastCalledWith(["doc", "list", "--pid", "42", "--holdings", "--json"]);
    sdkRun.mockResolvedValueOnce(envelope({ state: "ok", documents: null }, row.process));
    expect(await sources.holdings(row.process)).toBeNull();
    sdkRun.mockResolvedValueOnce(envelope({ state: "ok", documents: [] }, row.process));
    expect(await sources.holdings(row.process)).toEqual([]);
    sdkRun.mockResolvedValueOnce(
      envelope({ state: "ok", documents: holdings }, { ...row.process, processStartUtc: "new" }),
    );
    await expect(sources.holdings(row.process)).rejects.toThrow("different process incarnation");
  } finally {
    sdkRun.mockReset();
    f.machine.close();
  }
});

test("SDK process read errors fail the real census adapter and restart the full automatic wait", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const adapter = machineSources(undefined, {} as Providers, f.sources.update);
  const machine = createMachine(
    { ...f.sources, sessions: adapter.sessions },
    {
      automaticUpdates: { peaActive: () => false, handoff: vi.fn() },
    },
  );
  const census = (processReadErrors: unknown[] = []) =>
    JSON.stringify({
      result: { sessions: [], processReadErrors },
      exitCode: 0,
      diagnostics: [],
      resolved: {},
      binary: {},
      command: {},
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
    machine.close();
    f.machine.close();
    sdkRun.mockReset();
    vi.useRealTimers();
  }
});

test("controlled bridge failure keeps full confirmed documents with stale document evidence", async () => {
  const f = fixture();
  const controlled: ControlledActive = {
    ...row,
    case: "controlled-active",
    id: "controlled",
    detail: "ready",
    dialogs: null,
    origin: "test",
    project: null,
    worktree: "test",
    receipt: { payload: "installed", generationRoot: "root", receiptPath: "receipt" },
    bridge: {
      bridge: "ready",
      documents: [],
      modal: null,
      privateBytes: null,
      queue: null,
      sessionDescriptor: null,
      unresponsive: false,
    },
  };
  try {
    vi.mocked(f.sources.sessions).mockResolvedValue([controlled]);
    const first = await f.machine.refresh();
    vi.mocked(f.sources.sessions).mockResolvedValue([
      { ...controlled, bridge: { bridge: "unresponsive-endpoint" } },
    ]);
    const failed = await f.machine.refresh();
    expect(failed.revit.sessions?.[0]?.documents).toEqual([]);
    expect(failed.revit.sessions?.[0]?.documentsLeg.observedAtUtc).toBe(
      first.revit.sessions?.[0]?.documentsLeg.observedAtUtc,
    );
    expect(failed.revit.sessions?.[0]?.documentsLeg.error).toContain("not answering");
    expect(f.sources.documents).not.toHaveBeenCalled();
  } finally {
    f.machine.close();
  }
});

test("health aggregates every attachment while an ambiguous snapshot has no attach-selection fallback", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* connectTestBridge(42);
        yield* connectTestBridge(43);
        expect((yield* first.bridge.snapshot(undefined)).connected).toBe(false);
        const web = HttpRouter.toWebHandler(
          hostStatusRoute.pipe(Layer.provideMerge(Layer.succeed(RevitBridge, first.bridge))),
          { disableLogger: true },
        );
        yield* Effect.tryPromise(async () => {
          try {
            const response = await web.handler(
              new Request("http://host/host/status"),
              Context.empty() as never,
            );
            expect(await response.json()).toMatchObject({ bridgeIsConnected: true });
          } finally {
            await web.dispose();
          }
        });
      }).pipe(Effect.provide(RevitBridgeLive)),
    ),
  );
});

test("observers share the feed clock instead of resetting its deadline", async () => {
  const { sources, machine } = fixture();
  const stop = machine.observe(() => {});
  await machine.refresh();
  await machine.refresh();
  await machine.refresh();
  expect(vi.mocked(sources.update.refresh).mock.calls.filter(([feed]) => feed)).toHaveLength(1);
  const again = machine.observe(() => {});
  await machine.refresh();
  expect(vi.mocked(sources.update.refresh).mock.calls.filter(([feed]) => feed)).toHaveLength(1);
  again();
  stop();
  machine.close();
});

test("provider read errors expose the safe snapshot alongside refusal evidence", async () => {
  const f = fixture();
  try {
    const safe = await f.sources.providers();
    vi.mocked(f.sources.providers).mockResolvedValue({
      ...safe,
      readError: "persisted providers unreadable",
    });
    const value = await f.machine.refresh();
    expect(value.providers).toEqual(safe.providers);
    expect(value.legs.providers?.error).toContain("persisted providers unreadable");
  } finally {
    f.machine.close();
  }
});

test("a leg that never settles is a leg error after its deadline, not a frame that never comes", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.machine.close();
  f.sources.years = vi.fn(() => new Promise<never>(() => {}));
  const machine = createMachine(f.sources, { periodMs: 60_000 });
  const seen: Machine[] = [];
  try {
    machine.observe((value) => seen.push(value));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(seen).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.length).toBeGreaterThan(0);
    const latest = seen.at(-1)!;
    expect(latest.legs.years?.error).toMatch(/years leg exceeded/);
    expect(latest.revit.sessions).not.toBeNull();
  } finally {
    machine.close();
    vi.useRealTimers();
  }
});

test("process custody is the SDK census's word: observed without a receipt, controlled with one, null until read", async () => {
  const f = fixture();
  const start = Date.parse(row.process.processStartUtc);
  const controlled = {
    ...row,
    case: "controlled-active",
    id: "dev",
    process: { ...row.process, pid: 77, processStartUtc: "2026-10-09T00:00:01.0000000Z" },
  } as unknown as ControlledActive;
  vi.mocked(f.sources.sessions).mockResolvedValue([row, controlled]);
  vi.mocked(f.sources.attachments).mockResolvedValue([]);
  useHostMachine(f.machine);
  try {
    // Nothing has read the census: unknown, and asking starts the first read.
    expect(processCustody(42, start)).toBeNull();
    await f.machine.refresh();
    expect(processCustody(42, start)).toBe("observed");
    expect(processCustody(77, Date.parse(controlled.process.processStartUtc))).toBe("controlled");
    // A process the census does not list, or a reused pid with another start, is not guessed.
    expect(processCustody(999, start)).toBeNull();
    expect(processCustody(42, start + 1)).toBeNull();
  } finally {
    useHostMachine(undefined);
    f.machine.close();
  }
  expect(processCustody(42, start)).toBeNull();
});

/* ── Per-document access: the only place the browser learns who may write ───────────────── */

const grantHeld = (extra: Partial<HeadGrant> = {}): HeldGrant => ({
  thread: "t1",
  title: "Retag level 2",
  grant: {
    lifetime: { session: "product-open", openId: "product-id" },
    grantedAt: "2026-10-12T12:00:00.000Z",
    grantedVia: "local",
    expiresAt: "2026-10-12T13:00:00.000Z",
    revoked: null,
    ...extra,
  },
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
  grants: readonly HeldGrant[],
  at: string,
  acquired?: { sdk: { openId: string; isWorkshared: boolean | null }[]; products?: string[] },
  documentIdentity: AttachmentRead["documentIdentity"] = "sdk-open-v1",
) => {
  const f = fixture();
  vi.mocked(f.sources.grants.grants).mockReturnValue(grants);
  vi.mocked(f.sources.attachments).mockResolvedValue([{ ...attached, documentIdentity }]);
  if (acquired) {
    vi.mocked(f.sources.actions).mockResolvedValue([acquiring("open", "succeeded", row.process)]);
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
  const machine = createMachine(f.sources, { periodMs: 60_000, now: () => at });
  try {
    return (await machine.refresh()).revit.sessions![0]!.attachment!.documents!.map(
      (doc) => doc.access,
    );
  } finally {
    machine.close();
    f.machine.close();
  }
};
const accessAt = async (grants: readonly HeldGrant[], at: string) =>
  (await accessesAt(grants, at))[0];

test("access: a live grant on the exact lifetime draws rw with its thread and expiry", async () => {
  expect(await accessAt([grantHeld()], "2026-10-12T12:30:00.000Z")).toEqual({
    kind: "rw",
    context: "t1",
    label: "Retag level 2",
    until: "2026-10-12T13:00:00.000Z",
  });
});

test("access: expired, revoked and other-lifetime grants are read, and no grant is read", async () => {
  const read = { kind: "read" };
  expect(await accessAt([grantHeld()], "2026-10-12T13:00:00.000Z")).toEqual(read);
  expect(
    await accessAt(
      [grantHeld({ revoked: { at: "2026-10-12T12:10:00.000Z" } })],
      "2026-10-12T12:30:00.000Z",
    ),
  ).toEqual(read);
  expect(
    await accessAt(
      [grantHeld({ lifetime: { session: "other", openId: "product-id" } })],
      "2026-10-12T12:30:00.000Z",
    ),
  ).toEqual(read);
  expect(await accessAt([], "2026-10-12T12:30:00.000Z")).toEqual(read);
});

test("access: only the document Pea acquired is Pea's; a user document opened in Pea's Revit is read", async () => {
  const at = "2026-10-12T12:30:00.000Z";
  const sdk = [
    { openId: "product-id", isWorkshared: false },
    { openId: "user-b", isWorkshared: false },
  ];
  expect(await accessesAt([], at, { sdk, products: ["product-id", "user-b"] })).toEqual([
    { kind: "pea", acquisition: "launch" },
    { kind: "read" },
  ]);
  // A human grant on B in Pea's Revit is an ordinary grant.
  expect(
    (
      await accessesAt(
        [grantHeld({ lifetime: { session: "product-open", openId: "user-b" } })],
        at,
        {
          sdk,
          products: ["product-id", "user-b"],
        },
      )
    )[1],
  ).toMatchObject({ kind: "rw" });
  // Native facts unknown: the acquired copy is not certified independent, so it stays read.
  expect(await accessesAt([], at, { sdk: [{ openId: "product-id", isWorkshared: null }] })).toEqual(
    [{ kind: "read" }],
  );
});

test("access: one SDK id joins the acquisition and grant; without the identity marker both stay read", async () => {
  const at = "2026-10-12T12:30:00.000Z";
  // The SDK doc-list id and the bridge openId are the same string: SDK beta.202's one authority.
  const sdk = [{ openId: "product-id", isWorkshared: false }];
  expect(await accessesAt([], at, { sdk })).toEqual([{ kind: "pea", acquisition: "launch" }]);
  expect(await accessAt([grantHeld()], at)).toMatchObject({ kind: "rw" });
  // A payload that did not attest SDK identity: equal strings prove nothing, nothing writes.
  expect(await accessesAt([], at, { sdk }, null)).toEqual([{ kind: "read" }]);
  expect(await accessesAt([grantHeld()], at, undefined, null)).toEqual([{ kind: "read" }]);
});

test("bridge attachments project the identity marker only from its exact attested value", async () => {
  const view = (documentIdentity: string | null | undefined) => ({
    connected: true,
    sessionId: "product-open",
    processId: 42,
    processStartUtcUnixMs: 1000,
    state: { openDocuments: [], ...(documentIdentity === undefined ? {} : { documentIdentity }) },
  });
  const marks = await bridgeAttachments({
    list: Effect.succeed([view("sdk-open-v1"), view("sdk-open-v2"), view(null), view(undefined)]),
  } as never);
  expect(marks.map((attachment) => attachment.documentIdentity)).toEqual([
    "sdk-open-v1",
    null,
    null,
    null,
  ]);
});

test("access: a head move re-reads the machine through the grant source", async () => {
  const f = fixture();
  f.machine.close();
  const machine = createMachine(f.sources, {
    periodMs: 60_000,
    now: () => "2026-10-12T12:30:00.000Z",
  });
  const seen: Machine[] = [];
  const stop = machine.observe((value) => seen.push(value));
  const notify = vi.mocked(f.sources.grants.subscribe).mock.calls[0]![0];
  await machine.refresh();
  vi.mocked(f.sources.grants.grants).mockReturnValue([grantHeld()]);
  const before = seen.length;
  notify();
  await vi.waitFor(() => expect(seen.length).toBeGreaterThan(before));
  expect(seen.at(-1)!.revit.sessions![0]!.attachment!.documents![0]!.access).toMatchObject({
    kind: "rw",
  });
  stop();
  machine.close();
});

test("holdings retain nullable facts and last confirmed evidence after a failed read", async () => {
  const f = fixture();
  const value = [
    {
      openId: "sdk-open",
      title: "Model",
      holdings: {
        empty: false,
        unsaved: false,
        workshared: true,
        savedNotSynced: null,
        elements: [
          {
            id: 1,
            category: null,
            name: null,
            changedSinceSync: null,
            requesters: ["Bob", "Alice"],
          },
        ],
        worksets: [],
      },
    },
  ];
  try {
    vi.mocked(f.sources.holdings).mockResolvedValue(value);
    const first = (await f.machine.refresh()).revit.sessions![0]!;
    expect(first.holdings).toEqual(value);
    vi.mocked(f.sources.holdings).mockRejectedValueOnce(Error("holdings unavailable"));
    const stale = (await f.machine.refresh()).revit.sessions![0]!;
    expect(stale.holdings).toEqual(value);
    expect(stale.holdingsLeg.observedAtUtc).toBe(first.holdingsLeg.observedAtUtc);
    expect(stale.holdingsLeg.error).toContain("holdings unavailable");
  } finally {
    f.machine.close();
  }
});

test("failed receipt rows preserve acquisition provenance and controlled custody", async () => {
  const f = fixture();
  const failed = {
    ...controlled([]),
    case: "failed-receipt",
    detail: "Payload failed",
    execution: { allowed: false, code: "session.boot-blocked", detail: "Payload failed" },
    failure: {
      source: "journal",
      event: "failed",
      journalFile: "journal",
      message: "Payload failed",
      process: row.process,
    },
  } as SessionObservation;
  vi.mocked(f.sources.sessions).mockResolvedValue([failed]);
  vi.mocked(f.sources.actions).mockResolvedValue([acquiring("open", "succeeded", row.process)]);
  useHostMachine(f.machine);
  try {
    const result = await f.machine.refresh();
    expect(result.revit.sessions).toHaveLength(1);
    expect(result.revit.sessions![0]).toMatchObject({
      row: failed,
      whose: "pea",
      documents: null,
      attachment: null,
    });
    expect(processCustody(row.process.pid, Date.parse(row.process.processStartUtc))).toBe(
      "controlled",
    );
    expect(f.sources.documents).not.toHaveBeenCalled();
    expect(f.sources.holdings).not.toHaveBeenCalled();
  } finally {
    useHostMachine(undefined);
    f.machine.close();
  }
});

test("a switched-off automatic update announces its version once and never applies", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const handoff = vi.fn();
  const machine = createMachine(f.sources, {
    automaticUpdates: { peaActive: () => false, handoff },
  });
  Object.assign(f.sources.update.current(), {
    automatic: false,
    plan: { planId: "idle-plan", latest: "0.9.0", available: true, blockers: [], revits: [] },
  });
  vi.mocked(f.sources.sessions).mockResolvedValue([]);
  vi.mocked(f.sources.attachments).mockResolvedValue([]);
  try {
    await machine.refresh();
    vi.advanceTimersByTime(300_000);
    await machine.refresh();
    await machine.refresh();
    expect(f.sources.update.apply).not.toHaveBeenCalled();
    expect(f.sources.update.announce).toHaveBeenCalledExactlyOnceWith({
      kind: "available",
      version: "0.9.0",
    });
  } finally {
    machine.close();
    f.machine.close();
    vi.useRealTimers();
  }
});

test("a leg outage publishes one typed fault at its transition, not one per tick", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const fault = vi.fn();
  const machine = createMachine(f.sources, { fault });
  vi.mocked(f.sources.peers).mockRejectedValue(Error("no peers"));
  try {
    await machine.refresh();
    await machine.refresh();
    expect(fault).toHaveBeenCalledExactlyOnceWith({
      leg: "peers",
      kind: "error",
      elapsedMs: expect.any(Number),
    });
    vi.mocked(f.sources.peers).mockReturnValue(new Promise<never>(() => {}));
    const pending = machine.refresh();
    await vi.advanceTimersByTimeAsync(15_001);
    await pending;
    // Still the same outage: a deadline after an error is not a new transition.
    expect(fault).toHaveBeenCalledTimes(1);
    vi.mocked(f.sources.peers).mockResolvedValue([]);
    await machine.refresh();
    vi.mocked(f.sources.peers).mockReturnValue(new Promise<never>(() => {}));
    const stalled = machine.refresh();
    await vi.advanceTimersByTimeAsync(15_001);
    await stalled;
    expect(fault).toHaveBeenLastCalledWith({
      leg: "peers",
      kind: "deadline",
      elapsedMs: expect.any(Number),
    });
  } finally {
    machine.close();
    f.machine.close();
    vi.useRealTimers();
  }
});
