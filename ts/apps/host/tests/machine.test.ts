import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";
import { hostStatusRoute } from "../src/app.ts";
import type { Machine, MachineAttachment } from "@pe/agent-contracts";
import type {
  ControlledActive,
  DocListResult,
  ObservedActive,
  SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";
import {
  createMachine,
  machineSources,
  readMachinePeers,
  unavailableShare,
  type MachineSources,
} from "../src/machine.ts";
import type { Providers } from "../src/harness/providers.ts";
import { unreadLeg } from "../src/update-reader.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";

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
const attached: MachineAttachment = {
  session: "product-open",
  pid: 42,
  processStartUtcUnixMs: Date.parse(row.process.processStartUtc),
  documents: [{ session: "product-open", openId: "product-id" }],
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
  };
  const sources: MachineSources = {
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
      current: () => update,
      refresh: vi.fn(async () => update),
      apply: vi.fn(async () => update),
    },
    share: unavailableShare,
    subscribe: vi.fn(() => vi.fn()),
  };
  return { sources, machine: createMachine(sources, { periodMs: 60_000 }) };
}

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
    expect(session?.attachment).toBe(attached);
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
    expect(value.revit.unclassifiedAttachments).toEqual([reused]);
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
    sdkRun.mockResolvedValueOnce(envelope({ sessions: [row] }));
    expect(await sources.sessions()).toEqual([row]);
    expect(sdkRun).toHaveBeenLastCalledWith(["session", "list", "--all", "--json"]);
    sdkRun.mockResolvedValueOnce(envelope(docs, row.process));
    expect(await sources.documents(row.process)).toEqual(docs);
    expect(sdkRun).toHaveBeenLastCalledWith(["doc", "list", "--pid", "42", "--json"]);
    sdkRun.mockResolvedValueOnce(
      envelope(docs, { ...row.process, processStartUtc: "a-new-process" }),
    );
    await expect(sources.documents(row.process)).rejects.toThrow("different process incarnation");
  } finally {
    sdkRun.mockReset();
    f.machine.close();
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
