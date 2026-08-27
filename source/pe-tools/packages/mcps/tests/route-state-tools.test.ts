import { expect, test } from "vite-plus/test";

import { routeCommand, routeStateApply, routeStateRead } from "../src/pea/route-state.ts";

type ExecutableTool = {
  execute?: (input: never, context: never) => Promise<unknown>;
};

test("route-state tools keep discovery shallow and scope detail and writes to a document", async () => {
  // Explicit override: this test asserts URL routing, not host discovery (which requires a live
  // service file and would correctly fail without a running worktree host).
  const originalBaseUrl = process.env.PE_TOOLS_HOST_BASE_URL;
  process.env.PE_TOOLS_HOST_BASE_URL = "http://127.0.0.1:9";
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: URL; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    calls.push({
      method: init?.method ?? "GET",
      url: new URL(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Response.json(
      new URL(url).pathname === "/pe/route-state"
        ? [{ route: "family-types", title: "Family Types", description: "Review values." }]
        : { ok: true },
    );
  }) as typeof globalThis.fetch;

  const doc = "C:\\Models\\projectA.rvt";

  try {
    const discovery = await execute(routeStateRead, {}, {});
    await execute(routeStateRead, { route: "family-types", doc }, {});
    await execute(
      routeStateApply,
      {
        route: "family-types",
        doc,
        patches: [{ path: ["cells", "one", "proposal"], value: 1 }],
        expectedRevision: 7,
      },
      {},
    );
    await execute(
      routeCommand,
      { route: "family-types", doc, command: "refresh", input: {}, expectedRevision: 8 },
      { agent: { agentId: "pea", toolCallId: "tool-1" } },
    );
    await execute(
      routeCommand,
      { route: "family-types", doc, command: "refresh", input: {}, expectedRevision: 9 },
      { mcp: { extra: { requestId: 42 } } },
    );
    await execute(routeStateRead, { route: "parameter-links", doc }, {});

    expect(
      calls.map(({ method, url }) => [method, url.pathname, url.searchParams.get("doc")]),
    ).toEqual([
      ["GET", "/pe/route-state", null],
      ["GET", "/pe/route-state/family-types", doc],
      ["POST", "/pe/agent/route-state/family-types/apply", doc],
      ["POST", "/pe/agent/route-state/family-types/command", doc],
      ["POST", "/pe/agent/route-state/family-types/command", doc],
      ["GET", "/pe/route-state/parameter-links", doc],
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

    const missing = await execute(routeStateRead, { route: "family-types" }, {});
    expect(missing).toMatchObject({
      isError: true,
      content: expect.stringContaining("document address"),
    });
    expect(calls).toHaveLength(6);
    expect(JSON.stringify(discovery)).not.toContain('"key"');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.PE_TOOLS_HOST_BASE_URL;
    else process.env.PE_TOOLS_HOST_BASE_URL = originalBaseUrl;
  }
});

async function execute(tool: ExecutableTool, input: unknown, context: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error("Expected executable route-state tool.");
  return tool.execute(input as never, context as never);
}
