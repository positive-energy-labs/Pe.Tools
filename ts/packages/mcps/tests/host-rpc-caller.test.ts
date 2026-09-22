import { expect, test } from "vite-plus/test";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";

// Fixture standing in for a live /ops catalog (the caller's only real source).
const catalog: HostOperationDefinition[] = [
  {
    key: "revit.context.summary",
    displayName: "Get Revit Agent Context Summary",
    description: "Read compact current document and selection context.",
    searchTerms: ["agent-context", "summary"],
    intent: "Read",
    needs: "document",
    costTier: "Cheap",
    requestTypeName: "NoRequest",
    responseTypeName: "RevitAgentContextSummaryData",
  },
  {
    key: "scripting.execute",
    displayName: "Execute Revit Script",
    description: "Execute an inline or workspace-relative C# script in connected Revit.",
    searchTerms: ["script", "execute", "csharp", "revit"],
    intent: "Mutate",
    needs: "document",
    costTier: "Mutation",
    requestTypeName: "ExecuteRevitScriptRequest",
    responseTypeName: "ExecuteRevitScriptData",
  },
  {
    key: "scripting.workspace.bootstrap",
    displayName: "Bootstrap Script Workspace",
    description: "Create or update the host-owned C# Revit scripting workspace files.",
    searchTerms: ["script", "workspace", "bootstrap"],
    intent: "Mutate",
    needs: "nothing",
    costTier: "Mutation",
    requestTypeName: "ScriptWorkspaceBootstrapRequest",
    responseTypeName: "ScriptWorkspaceBootstrapData",
  },
];

test("script execution requires an explicit initiating actor before admission", async () => {
  const client = new HostRpcCaller({
    hostBaseUrl: "http://127.0.0.1:5180",
    bridgeSessionId: "source",
    openDocumentId: "original",
    catalogOverride: catalog,
  });
  await expect(
    client.callOperation("scripting.execute", { scriptContent: 'WriteLine("ok");' }),
  ).rejects.toThrow("initiating actor");
});

test("catalog enrichment preserves the explicit session selector", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return new Response(JSON.stringify({ operations: catalog }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new HostRpcCaller({
      hostBaseUrl: "http://127.0.0.1:5181",
      bridgeSessionId: "session:catalog-e2e",
    });
    // Every catalog op stays resolvable at transport level, scripting.* included.
    expect((await client.getOperation("scripting.execute"))?.key).toBe("scripting.execute");

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/ops");
    expect(new Headers(calls[0].init?.headers).get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(
      "session:catalog-e2e",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a transport failure names the URL it tried on the call wire; enrichment just goes quiet", async () => {
  // `pea host operations call` against a dead/wrong-lane host used to print a bare
  // `fetch failed`: no port, no path, indistinguishable from having resolved the wrong host.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    const client = new HostRpcCaller({ hostBaseUrl: "http://127.0.0.1:53999" });
    await expect(client.call("host.status")).rejects.toThrow("POST http://127.0.0.1:53999/call");
    expect(await client.getOperation("revit.context.summary")).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed call carries the operation's safety label from the catalog", async () => {
  const result = await new HostRpcCaller({
    hostBaseUrl: "http://127.0.0.1:1",
    timeoutMs: 500,
    catalogOverride: catalog,
  }).callOperation("revit.context.summary");

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected rejected operation");
  expect(result.operation?.safety).toBe("document, Cheap");
});

test("unknown dynamic operation keys fail at transport with catalog enrichment absent", async () => {
  const result = await new HostRpcCaller({
    hostBaseUrl: "http://127.0.0.1:1",
    timeoutMs: 500,
    catalogOverride: catalog,
  }).callOperation("missing.operation");

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected rejected operation");
  expect(result.operation).toBeUndefined();
});

test("a refused call preserves the host's resolved target", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        kind: "CatalogLookup",
        message: "Unsupported bridge operation 'revit.context.summary'. Use pe_find.",
        resolvedTarget: { session: "session-a", document: "C:/Models/A.rvt" },
      }),
      { status: 404, headers: { "content-type": "application/problem+json" } },
    );
  try {
    const result = await new HostRpcCaller({
      hostBaseUrl: "http://host.test",
      catalogOverride: catalog,
    }).callOperation("revit.context.summary");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejected operation");
    expect(result.resolvedTarget).toEqual({
      session: "session-a",
      document: "C:/Models/A.rvt",
    });
    expect(result.problem).toMatchObject({ kind: "CatalogLookup" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
