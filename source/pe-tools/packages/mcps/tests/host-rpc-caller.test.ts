import { expect, test } from "vite-plus/test";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";
import { ScriptingTools } from "../src/shared/scripting.ts";

// Fixture standing in for a live /ops catalog (the caller's only real source).
const catalog: HostOperationDefinition[] = [
  {
    key: "revit.context.summary",
    displayName: "Get Revit Agent Context Summary",
    description: "Read compact current document and selection context.",
    searchTerms: ["agent-context", "summary"],
    intent: "Read",
    requiresActiveDocument: true,
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
    requiresActiveDocument: true,
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
    costTier: "Mutation",
    requestTypeName: "ScriptWorkspaceBootstrapRequest",
    responseTypeName: "ScriptWorkspaceBootstrapData",
  },
];

test("script execution forwards its selector in one direct /call without lifecycle work", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return new Response(JSON.stringify({ status: "Succeeded" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new HostRpcCaller({
      hostBaseUrl: "http://127.0.0.1:5180",
      bridgeSessionId: "sandbox:source-e2e",
    });
    await new ScriptingTools(client, { workspaceKey: "acceptance" }).execute({
      scriptContent: 'WriteLine("ok");',
    });

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/call");
    expect(new Headers(calls[0].init?.headers).get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(
      "sandbox:source-e2e",
    );
    const body = calls[0].init?.body;
    if (typeof body !== "string") throw new Error("expected JSON request body");
    expect(JSON.parse(body)).toMatchObject({ key: "scripting.execute" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operation discovery preserves the explicit session selector", async () => {
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
      bridgeSessionId: "sandbox:catalog-e2e",
    });
    await client.searchOperations({ query: "context" });

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/ops");
    expect(new Headers(calls[0].init?.headers).get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(
      "sandbox:catalog-e2e",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("derives capability map from the op catalog", async () => {
  const result = await new HostRpcCaller({ catalogOverride: catalog }).searchOperations({
    projection: "capability-map",
  });

  expect(Array.isArray(result)).toBe(false);
  if (Array.isArray(result)) throw new Error("expected capability-map projection");
  expect(result.rowCount).toBeGreaterThan(0);
  expect(result.matchedOperationKeys).toContain("revit.context.summary");
  expect(result.rendered).toContain("## Context");
});

test("hides scripting.* from the catalog projection while keeping it at transport level", async () => {
  const caller = new HostRpcCaller({ catalogOverride: catalog });

  // Projection: neither ranked matches nor the capability map surface scripting.*.
  const matches = await caller.searchOperations({ query: "script execute csharp", limit: 8 });
  expect(Array.isArray(matches)).toBe(true);
  if (!Array.isArray(matches)) throw new Error("expected matches projection");
  expect(matches.map((result) => result.key)).not.toContain("scripting.execute");
  expect(matches.map((result) => result.key)).not.toContain("scripting.workspace.bootstrap");

  const map = await caller.searchOperations({ projection: "capability-map" });
  expect(Array.isArray(map)).toBe(false);
  if (Array.isArray(map)) throw new Error("expected capability-map projection");
  expect(map.matchedOperationKeys).not.toContain("scripting.execute");
  expect(map.rendered).not.toContain("scripting.");

  // Transport: the op stays resolvable for host_operation_call enrichment/dispatch.
  const transportOp = await caller.getOperation("scripting.execute");
  expect(transportOp?.key).toBe("scripting.execute");
});

test("unmatched mutate searches hint at the script_execute tool, not a scripting op", async () => {
  const results = await new HostRpcCaller({ catalogOverride: catalog }).searchOperations({
    query: "duct layout route mains branches",
    intent: "Mutate",
    limit: 8,
  });

  expect(Array.isArray(results)).toBe(true);
  if (!Array.isArray(results)) throw new Error("expected matches projection");
  expect(results).toHaveLength(1);
  expect(results[0].key).toBe("script_execute");
  expect(results[0].usageHint).toContain("script_execute tool");
  expect(results.map((result) => result.key)).not.toContain("scripting.execute");
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
