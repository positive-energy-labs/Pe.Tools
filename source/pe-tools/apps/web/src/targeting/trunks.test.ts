import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";

import type { WorldFacts } from "#/host/fleet";
import { resolveTarget, type SessionFacts } from "#/host/target";
import { documentTrunk, worldTrunk } from "#/targeting/trunks";

const session = (overrides: Partial<SessionFacts> = {}): SessionFacts => ({
  sessionId: "bridge-25",
  sdkSessionId: "pe.app-25",
  processId: 25,
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
});

afterEach(() => vi.restoreAllMocks());

describe("targeting trunks", () => {
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
        pid: 25,
        openDocumentCount: 1,
        session: controlled,
      },
      {
        id: "bridge-user",
        custody: "observed",
        phase: "ready",
        pid: 77,
        openDocumentCount: 1,
        session: observed,
      },
      {
        id: "installed-25",
        custody: "controlled",
        phase: "ready",
        pid: 88,
        openDocumentCount: 0,
        session: installed,
        row: { id: "installed-25" } as WorldFacts["row"],
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
      basis: ["sessions.status", "bridge.sessions.list"],
    });

    expect(result).toMatchObject({
      options: [
        { id: "session:pe.app-25", label: "pe.app-25", sub: "controlled" },
        { id: "observed", label: "Revit 77", sub: "observed" },
        { id: "88", label: "installed-25", sub: "controlled" },
      ],
      lane: "live",
      at: 123,
      basis: ["sessions.status", "bridge.sessions.list"],
    });
    for (const option of result.options ?? [])
      expect(resolveTarget(sessions, option.id)).toMatchObject({ kind: "resolved" });
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

    expect(request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown)).toEqual(
      [
        { path: "recent:Equal title.rvt", id: "pe.app-25", conflictPolicy: "keep" },
        { path: "C:\\Models\\Local.rvt", id: "pe.app-25" },
      ],
    );
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
});
