import { MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import { expect, test } from "vite-plus/test";

import { routeCommand, routeStateApply, routeStateRead } from "../src/pea/route-state.ts";

type ExecutableTool = {
  execute?: (input: never, context: never) => Promise<unknown>;
};

test("route-state tools keep discovery shallow and scope detail and writes to the active thread", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: URL }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    calls.push({ method: init?.method ?? "GET", url: new URL(url) });
    return Response.json({ ok: true });
  }) as typeof globalThis.fetch;

  const requestContext = {
    get(key: string) {
      if (key === "controller") return { threadId: "thread/controller" };
      if (key === MASTRA_THREAD_ID_KEY) return "thread/fallback";
      return undefined;
    },
  };
  const context = { requestContext };

  try {
    await execute(routeStateRead, {}, {});
    await execute(routeStateRead, { route: "family-types" }, context);
    await execute(
      routeStateApply,
      { route: "family-types", patches: [{ path: ["cells", "one", "proposal"], value: 1 }] },
      context,
    );
    await execute(routeCommand, { route: "family-types", command: "refresh", input: {} }, context);
    await execute(
      routeStateRead,
      { route: "parameter-links" },
      {
        requestContext: {
          get: (key: string) => (key === MASTRA_THREAD_ID_KEY ? "thread/fallback" : undefined),
        },
      },
    );

    expect(
      calls.map(({ method, url }) => [method, url.pathname, url.searchParams.get("threadId")]),
    ).toEqual([
      ["GET", "/pe/route-state", null],
      ["GET", "/pe/route-state/family-types", "thread/controller"],
      ["POST", "/pe/agent/route-state/family-types/apply", "thread/controller"],
      ["POST", "/pe/agent/route-state/family-types/command", "thread/controller"],
      ["GET", "/pe/route-state/parameter-links", "thread/fallback"],
    ]);

    const missing = await execute(routeStateRead, { route: "family-types" }, {});
    expect(missing).toMatchObject({
      isError: true,
      content: expect.stringContaining("active Pea thread"),
    });
    expect(calls).toHaveLength(5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function execute(tool: ExecutableTool, input: unknown, context: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error("Expected executable route-state tool.");
  return tool.execute(input as never, context as never);
}
