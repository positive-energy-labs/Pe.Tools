import { expect, test, vi } from "vite-plus/test";
import { turnContextKey } from "@pe/agent-contracts";

import { routeCommand, routeStateApply, routeStateRead, scopeSet } from "../src/pea/route-state.ts";

type ExecutableTool = {
  execute?: (input: never, context: never) => Promise<unknown>;
};

test("route-state tools keep discovery shallow and key detail, writes and scope_set by the turn's Scope", async () => {
  // Explicit override: this test asserts URL routing, not host discovery (which requires a live
  // service file and would correctly fail without a running worktree host).
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const calls: Array<{ method: string; url: URL; body?: unknown }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    calls.push({
      method: init?.method ?? "GET",
      url: new URL(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Response.json(
      new URL(url).pathname === "/pe/route-state"
        ? [{ route: "family-types", title: "Family Types", description: "Review values." }]
        : { ok: true, revision: 4 },
    );
  });

  const doc = "C:\\Models\\projectA.rvt";
  const turn = {
    id: "7d2f6a3e-4a3b-4d2e-9d1a-0f2b3c4d5e6f",
    thread: "thread-1",
    scope: { session: "pe.app-25", document: doc },
    revision: 3,
  };
  const turnContext = (extra: Record<string, unknown> = {}) => ({
    ...extra,
    requestContext: { [turnContextKey]: turn },
  });

  try {
    const discovery = await execute(routeStateRead, {}, {});
    await execute(routeStateRead, { route: "family-types" }, turnContext());
    await execute(
      routeStateApply,
      {
        route: "family-types",
        patches: [{ path: ["cells", "one", "proposal"], value: 1 }],
        expectedRevision: 7,
      },
      turnContext(),
    );
    await execute(
      routeCommand,
      { route: "family-types", command: "refresh", input: {}, expectedRevision: 8 },
      turnContext({ agent: { agentId: "pea", toolCallId: "tool-1" } }),
    );
    await execute(
      routeCommand,
      { route: "family-types", command: "refresh", input: {}, expectedRevision: 9 },
      turnContext({ mcp: { extra: { requestId: 42 } } }),
    );
    // No turn: the empty Scope, not a refusal.
    await execute(routeStateRead, { route: "parameter-links" }, {});
    const set = await execute(scopeSet, { session: "dev-26", document: null }, turnContext());

    expect(
      calls.map(({ method, url }) => [
        method,
        url.pathname,
        url.searchParams.get("session"),
        url.searchParams.get("doc"),
      ]),
    ).toEqual([
      ["GET", "/pe/route-state", null, null],
      ["GET", "/pe/route-state/family-types", "pe.app-25", doc],
      ["POST", "/pe/agent/route-state/family-types/apply", "pe.app-25", doc],
      ["POST", "/pe/agent/route-state/family-types/command", "pe.app-25", doc],
      ["POST", "/pe/agent/route-state/family-types/command", "pe.app-25", doc],
      ["GET", "/pe/route-state/parameter-links", null, null],
      ["PUT", "/pe/scope/thread-1", null, null],
    ]);

    expect(calls[2]?.body).toEqual({
      patches: [{ path: ["cells", "one", "proposal"], value: 1 }],
      expectedRevision: 7,
    });
    expect(calls[3]?.body).toEqual({
      command: "refresh",
      input: {},
      expectedRevision: 8,
      requestId: "tool-1",
    });
    expect(calls[4]?.body).toEqual({
      command: "refresh",
      input: {},
      expectedRevision: 9,
      requestId: "42",
    });
    expect(calls[6]?.body).toEqual({
      scope: { session: "dev-26", document: null },
      expectedRevision: 3,
      turn: turn.id,
    });
    expect(set).toMatchObject({ revision: 4, note: expect.stringContaining("revision 3") });
    expect(await execute(scopeSet, { session: null, document: null }, {})).toMatchObject({
      isError: true,
    });
    expect(JSON.stringify(discovery)).not.toContain('"key"');
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

async function execute(tool: ExecutableTool, input: unknown, context: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error("Expected executable route-state tool.");
  return tool.execute(input as never, context as never);
}
