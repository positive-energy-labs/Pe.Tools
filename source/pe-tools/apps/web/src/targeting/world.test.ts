import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { unbound } from "#/state/route-store";
import type {
  Envelope,
  RecentDocument,
  SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";

import type { WorldFacts } from "#/host/fleet";
import type { SessionFacts } from "#/host/target";
import { documentTrunk, worldTrunk, type WorldLifecycleReceipt } from "#/targeting/world";

const session = (overrides: Partial<SessionFacts> = {}): SessionFacts => ({
  sessionId: "bridge-25",
  sdkSessionId: "pe.app-25",
  processId: 25,
  processStartUtcUnixMs: 1_000,
  lane: "dev",
  custody: "controlled",
  openDocumentCount: 1,
  ...overrides,
});

const recent = (modelGuid: string, path: string): RecentDocument => ({
  isCloud: true,
  modelGuid,
  path,
  projectGuid: "project",
  rank: 0,
  region: "US",
  title: "Equal title.rvt",
  year: 2026,
  savedYear: null,
  savedYearFailure: null,
});

const observation = (id: string, pid: number): SessionObservation => ({
  case: "controlled-active",
  kind: "installed",
  bridge: { bridge: "ready", sessionDescriptor: "C:\\session.json" },
  detail: "ready",
  id,
  observedAtUtc: "2026-08-30T12:00:00.000Z",
  origin: "test",
  process: {
    executable: "C:\\Revit.exe",
    pid,
    processStartUtc: new Date(pid * 1_000).toISOString(),
  },
  project: null,
  receipt: {
    payload: "installed",
    generationRoot: "C:\\generation",
    receiptPath: "C:\\session.json",
  },
  worktree: "consumer",
  year: 2025,
});

afterEach(() => vi.restoreAllMocks());

const envelope = <T>(result: T, diagnostics: Envelope<T>["diagnostics"] = []): Envelope<T> => ({
  binary: {
    assembly: null,
    hostExecutable: null,
    informationalVersion: "0.1.0-beta.143",
    origin: "checkout",
    sha256: null,
  },
  command: { commandManifest: null, commandRoot: "C:\\sdk", commandRule: "exact", cwd: "C:\\repo" },
  diagnostics,
  guide: "pe-revit guide session",
  nextSteps: ["inspect session list"],
  related: ["session list"],
  resolved: null,
  result,
});

const lifecycleVerbs = (settled: (receipt: WorldLifecycleReceipt) => void = () => {}) =>
  worldTrunk.verbs<"world">({
    start: () => ({ lane: "installed", year: "25", doc: "Model.rvt" }),
    started: () => {},
    settled,
    failed: () => {},
    finished: () => {},
  });

const worldFeed = (worlds: readonly WorldFacts[]) =>
  worldTrunk.feed({
    worlds,
    sessions: worlds.flatMap((world) => (world.session ? [world.session] : [])),
    isLoading: false,
    stale: false,
    error: null,
    basis: [],
  });

describe("targeting world", () => {
  it("keeps the open document catalog available when the active read is unbound or failed", () => {
    const open = [{ id: "C:\\Models\\Open.rvt", label: "Open" }];
    for (const active of [
      AsyncResult.success(unbound(null, [])),
      AsyncResult.fail(Error("active unavailable")),
    ]) {
      expect(documentTrunk.feed(active, undefined, "live", open)).toMatchObject({
        state: "ready",
        options: open,
      });
    }
  });
  it("names fused worlds by SDK session id or pid and discloses custody", () => {
    const controlled = session();
    const observed = session({
      sessionId: "bridge-user",
      sdkSessionId: undefined,
      processId: 77,
      lane: null,
      custody: "observed",
    });
    const installed = session({
      sessionId: "bridge-installed",
      sdkSessionId: undefined,
      processId: 88,
      lane: "installed",
    });
    const worlds: WorldFacts[] = [
      {
        id: "pe.app-25",
        custody: "controlled",
        phase: "ready",
        detail: "ready",
        pid: 25,
        session: controlled,
      },
      {
        id: "bridge-user",
        custody: "observed",
        phase: "ready",
        detail: "ready",
        pid: 77,
        session: observed,
      },
      {
        id: "installed-25",
        custody: "controlled",
        phase: "ready",
        detail: "ready",
        pid: 88,
        session: installed,
        row: observation("installed-25", 88),
      },
      {
        id: "orphan",
        custody: "observed",
        phase: "ready",
        detail: "ready",
        pid: 99,
      },
    ];

    const sessions = [controlled, observed, installed];
    const result = worldTrunk.feed({
      worlds,
      sessions,
      isLoading: false,
      stale: false,
      error: null,
      at: 123,
      basis: ["sessions.list", "bridge.sessions.list"],
    });

    expect(result).toMatchObject({
      options: [
        { id: "pe.app-25", label: "pe.app-25", sub: "controlled" },
        { id: "bridge-user", label: "Revit 77", sub: "observed" },
        { id: "bridge-installed", label: "installed-25", sub: "controlled" },
      ],
      lane: "live",
      at: 123,
      basis: ["sessions.list", "bridge.sessions.list"],
    });
    for (const option of result.options ?? [])
      expect(worldTrunk.resolve(worlds, option.id)).toBeDefined();
  });

  it("never offers gone or failed worlds as targets", () => {
    const row = observation("pe.app-25", 25);
    const worlds: WorldFacts[] = [
      { id: "ready", custody: "controlled", phase: "ready", detail: "ready", row },
      { id: "gone", custody: "controlled", phase: "gone", detail: "gone", row },
      { id: "failed", custody: "controlled", phase: "failed", detail: "failed", row },
    ];

    expect(worldFeed(worlds).options?.map((option) => option.label)).toEqual(["ready"]);
  });

  it("lets the SDK decide lifecycle custody for an observed world", async () => {
    const settled = vi.fn<(receipt: WorldLifecycleReceipt) => void>();
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { action } = JSON.parse(init?.body as string) as { action: "restart" | "stop" };
      const result =
        action === "restart"
          ? {
              id: "bridge-user",
              state: "failed" as const,
              legs: [
                {
                  name: "custody",
                  status: "failed",
                  detail: "observed",
                  observedAtUtc: "2026-09-01T00:00:00Z",
                },
              ],
              dropped: [],
              reopened: null,
            }
          : {
              id: "bridge-user",
              state: "blocked" as const,
              legs: [
                {
                  name: "custody",
                  status: "blocked",
                  detail: "observed",
                  observedAtUtc: "2026-09-01T00:00:00Z",
                },
              ],
            };
      return new Response(
        JSON.stringify(
          envelope(result, [
            {
              code: action === "restart" ? "session.no-match" : "session.stop-blocked",
              detail: "session is observed",
              fix: null,
            },
          ]),
        ),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    });
    const observed: WorldFacts = {
      id: "bridge-user",
      custody: "observed",
      phase: "ready",
      detail: "ready",
      pid: 77,
      session: session({
        sessionId: "bridge-user",
        sdkSessionId: undefined,
        processId: 77,
        custody: "observed",
      }),
    };

    const feed = worldFeed([observed]);
    const bound = { world: "observed" };
    const verbs = lifecycleVerbs(settled);
    for (const verb of [verbs.restart, verbs.stop]) {
      expect(verb.refuse(bound, { world: feed })).toBeNull();
      expect(await verb.run(bound, { world: feed })).toContain("session is observed");
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(settled.mock.calls[0]![0]).toMatchObject({
      action: "restart",
      result: { state: "failed", legs: [{ name: "custody" }] },
      diagnostics: [{ code: "session.no-match" }],
      nextSteps: ["inspect session list"],
    });
  });

  it("posts the SDK session body for every controlled lifecycle verb", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as { action: "start" | "restart" | "stop" };
      const result =
        body.action === "start"
          ? { id: "pe.app-25", state: "failed" as const, legs: [] }
          : body.action === "restart"
            ? {
                id: "pe.app-25",
                state: "failed" as const,
                legs: [],
                dropped: [],
                reopened: null,
              }
            : { id: "pe.app-25", state: "stopped" as const };
      return new Response(JSON.stringify(envelope(result)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const controlled: WorldFacts = {
      id: "pe.app-25",
      custody: "controlled",
      phase: "ready",
      detail: "ready",
      pid: 25,
      session: session(),
    };

    const verbs = lifecycleVerbs();
    const empty = worldFeed([]);
    const ready = worldFeed([controlled]);
    const unresponsive = worldFeed([{ ...controlled, phase: "unresponsive" }]);
    const bound = { world: "pe.app-25" };

    await verbs.start.run({ world: null }, { world: empty });
    await verbs.restart.run(bound, { world: ready });
    await verbs.stop.run(bound, { world: ready });
    await verbs.stop.run(bound, { world: unresponsive });

    expect(
      request.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as unknown),
    ).toEqual([
      { action: "start", lane: "installed", year: "25", doc: "Model.rvt" },
      { action: "restart", id: "pe.app-25" },
      { action: "stop", id: "pe.app-25" },
      { action: "stop", id: "pe.app-25", force: true },
    ]);
  });

  it("refuses observed document picks before HTTP", async () => {
    const request = vi.spyOn(globalThis, "fetch");

    await expect(
      documentTrunk.pick(session({ sdkSessionId: undefined, custody: "observed" }), "model-a", [
        recent("model-a", "cloud:a"),
      ]),
    ).rejects.toThrow("open the document in Revit; this session is observed");
    expect(request).not.toHaveBeenCalled();
  });

  it("opens cloud recents by title with keep and local recents by path", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ result: { state: "ok" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const cloud = recent("model-a", "cloud:a");
    const local: RecentDocument = {
      ...recent("ignored", "C:\\Models\\Local.rvt"),
      isCloud: false,
      modelGuid: null,
      title: "Local.rvt",
    };

    await documentTrunk.pick(session(), "model-a", [cloud]);
    await documentTrunk.pick(session(), local.path, [local]);
    await documentTrunk.activate(session(), "C:\\Models\\Already Open.rvt");

    expect(
      request.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as unknown),
    ).toEqual([
      { path: "recent:Equal title.rvt", id: "pe.app-25", conflictPolicy: "keep" },
      { path: "C:\\Models\\Local.rvt", id: "pe.app-25" },
      { path: "C:\\Models\\Already Open.rvt", id: "pe.app-25" },
    ]);
  });

  it("surfaces an SDK diagnostic when document open has no success receipt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {},
          diagnostics: [{ code: "doc.no-match", detail: "no file at recent:Equal title.rvt" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      documentTrunk.pick(session(), "model-a", [recent("model-a", "cloud:a")]),
    ).rejects.toThrow("no file at recent:Equal title.rvt");
  });

  it("reopens the exact durable copy when clone reports that its output already exists", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            diagnostics: [{ code: "doc.output-exists", detail: "output already exists" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { state: "ok" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await documentTrunk.clone(
      session(),
      "C:\\Models\\Central.rvt",
      "C:\\Models\\Central.PeTakeoffs.rvt",
    );

    expect(request.mock.calls.map(([url]) => url)).toEqual(["/docs/clone", "/docs/open"]);
    expect(
      request.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as unknown),
    ).toEqual([
      {
        source: "C:\\Models\\Central.rvt",
        out: "C:\\Models\\Central.PeTakeoffs.rvt",
        id: "pe.app-25",
      },
      { path: "C:\\Models\\Central.PeTakeoffs.rvt", id: "pe.app-25" },
    ]);
  });
});
