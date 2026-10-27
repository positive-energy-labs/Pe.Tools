import { expect, test, vi } from "vite-plus/test";
import type { ActionReceipt, Machine } from "@pe/agent-contracts";
import type {
  DocListResult,
  ObservedActive,
  SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";
import {
  createMachine,
  machineSources,
  unavailableShare,
  type AttachmentRead,
  type HeldTarget,
  type MachineSources,
} from "../src/machine.ts";
import type { Providers } from "../src/harness/providers.ts";
import { unreadLeg } from "../src/update-reader.ts";
import { planAcquisition } from "../src/acquisition.ts";
import { sdkBinary, sdkCommand } from "./sdk-replay.ts";

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
    targets: {
      targets: vi.fn((): readonly HeldTarget[] => []),
      subscribe: vi.fn(() => vi.fn()),
    },
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
    footprint: [],
    consent: { by: "press" },
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

test("automatic update requires two continuous Revit-free minutes and waits for Pea", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let busy = false;
  const machine = createMachine(f.sources, {
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
    machine.close();
    f.machine.close();
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
    f.machine.close();
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
      binary: sdkBinary,
      command: sdkCommand,
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
    machine.close();
    f.machine.close();
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
  vi.useFakeTimers();
  const f = fixture();
  const machine = createMachine(f.sources, { automaticUpdates: { peaActive: () => false } });
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
    machine.close();
    f.machine.close();
    vi.useRealTimers();
  }
});
