import { expect, test } from "vite-plus/test";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";

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

test("falls back to scripting for unmatched mutate searches", async () => {
  const results = await new HostRpcCaller({ catalogOverride: catalog }).searchOperations({
    query: "duct layout route mains branches",
    intent: "Mutate",
    limit: 8,
  });

  expect(Array.isArray(results)).toBe(true);
  if (!Array.isArray(results)) throw new Error("expected matches projection");
  expect(results.map((result) => result.key)).toContain("scripting.execute");
  expect(results.map((result) => result.key)).toContain("scripting.workspace.bootstrap");
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
