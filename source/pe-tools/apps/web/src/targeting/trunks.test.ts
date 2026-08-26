import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";

import type { WorldFacts } from "#/host/fleet";
import type { SessionFacts } from "#/host/target";
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
        row: { id: "installed-25" } as WorldFacts["row"],
      },
    ];

    expect(
      worldTrunk.feed({
        worlds,
        sessions: [controlled, observed],
        isLoading: false,
        stale: false,
        error: null,
        at: 123,
        basis: ["sessions.status", "bridge.sessions.list"],
      }),
    ).toMatchObject({
      options: [
        { id: "session:pe.app-25", label: "pe.app-25", sub: "controlled" },
        { id: "observed", label: "Revit 77", sub: "observed" },
        { id: "session:installed-25", label: "installed-25", sub: "controlled" },
      ],
      lane: "live",
      at: 123,
      basis: ["sessions.status", "bridge.sessions.list"],
    });
  });

  it("keeps equal document titles distinct by document identity", () => {
    const result = documentTrunk.feed(
      AsyncResult.success({ value: null, at: 100, basis: ["active"], bound: true }),
      AsyncResult.success({
        value: [recent("model-a", "cloud:a"), recent("model-b", "cloud:b")],
        at: 200,
        basis: ["pe.app-25", "2026"],
        bound: true,
      }),
    );

    expect(result.options).toEqual([
      { id: "model-a", label: "Equal title.rvt", sub: "cloud" },
      { id: "model-b", label: "Equal title.rvt", sub: "cloud" },
    ]);
    expect(result).toMatchObject({ at: 200, basis: ["pe.app-25", "2026"] });
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

  it("invalidates the current read after a successful document pick", async () => {
    const invalidate = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: { state: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      documentTrunk.pick(session(), "model-a", [recent("model-a", "cloud:a")], invalidate),
    ).resolves.toBe("opened Equal title.rvt");
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
