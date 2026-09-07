import { createSettingsCommandHandlers } from "../src/pea/settings-commands.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  address,
  familiesRouteState,
  familyRouteState,
  settingsRouteState,
} from "@pe/agent-contracts";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";
import { createFamiliesCommandHandlers } from "../src/pea/families-commands.ts";
import { createFamilyCommandHandlers } from "../src/pea/family-commands.ts";

afterEach(() => vi.restoreAllMocks());
const scope = { kind: "document" as const, document: address("C:\\Models\\Test.rvt") };
const opened = {
  rawContent: '{"patch":{"parameters":{"$preset":"@local/_params/width"}}}',
  composedContent: '{"patch":{"parameters":{"Width":{"value":"24in"}}}}',
  validation: { isValid: true, issues: [] },
  metadata: { documentId: { stableId: "C:\\Settings\\width.json" }, versionToken: { value: "v1" } },
};

test("native route plan/apply sends composed patch and reviewed included family hashes, preserving residue", async () => {
  const doc = familiesRouteState.schema.parse({});
  const entry = {
    familyId: 1,
    familyName: "Box",
    planHash: "hash-1",
    changes: [{ section: "parameters", key: "Width", kind: "Modify" }],
    runEffects: [],
    refusals: [],
  };
  const receipt = {
    familyId: 1,
    success: false,
    converged: false,
    residue: entry.changes,
    errors: ["rolled back"],
    artifactDirectory: "C:\\Evidence",
  };
  const call = vi
    .spyOn(HostRpcCaller.prototype, "call")
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({ families: [entry], diagnostics: [] } as never)
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({
      receipts: [receipt],
      diagnostics: [{ code: "BatchIssue", path: "$", message: "review receipts" }],
    } as never);
  const ctx = {
    scope,
    getDoc: () => doc,
    setDoc: async (next: typeof doc) => {
      Object.assign(doc, next);
    },
  };
  const handlers = createFamiliesCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" });
  await handlers.plan({ profilePath: "width", scope: { familyNames: ["Box"] } }, ctx);
  expect(call.mock.calls[1]).toEqual(["familyfoundry.plan", { patchJson: opened.composedContent }]);
  await expect(handlers.apply({ expectedPlanHashes: { "1": "stale" } }, ctx)).rejects.toThrow(
    "reviewed family plans",
  );
  expect(call).toHaveBeenCalledTimes(2);
  const input = familiesRouteState.commands.apply.input.parse({
    expectedPlanHashes: { "1": "hash-1" },
  });
  await handlers.apply(input, ctx);
  expect(call.mock.calls[3]).toEqual([
    "familyfoundry.apply",
    { patchJson: opened.composedContent, expectedPlanHashes: { "1": "hash-1" } },
  ]);
  expect(doc.apply?.receipts).toEqual([receipt]);
  expect(doc.apply?.diagnostics[0]?.code).toBe("BatchIssue");
  expect(familiesRouteState.schema.parse(doc).apply?.receipts[0]?.residue).toEqual(entry.changes);
});

test("native build stores convergence separately and invalid composition cannot reach Revit", async () => {
  const doc = familyRouteState.schema.parse({});
  const built = {
    reading: { at: scope.document, version: "v1", observedAt: "2026-09-06T00:00:00Z" },
    familyName: "Box",
    outputPath: "C:\\Out\\Box.rfa",
    templatePath: "template.rft",
    converged: true,
    residueCount: 0,
  };
  const call = vi
    .spyOn(HostRpcCaller.prototype, "call")
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce(built as never)
    .mockResolvedValueOnce({
      ...opened,
      composedContent: null,
      validation: { isValid: false, issues: [{ path: "$", message: "invalid include" }] },
    } as never);
  const ctx = {
    scope,
    getDoc: () => doc,
    setDoc: async (next: typeof doc) => {
      Object.assign(doc, next);
    },
  };
  const handlers = createFamilyCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" });
  const input = {
    documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "box" },
    outputPath: built.outputPath,
  };
  await handlers.build_evidence(input, ctx);
  expect(doc.build).toEqual(built);
  expect(doc.evidence).toBeUndefined();
  expect(call.mock.calls[1]).toEqual([
    "revit.apply.family-model",
    { modelJson: opened.composedContent, outputPath: built.outputPath },
  ]);
  await expect(handlers.build_evidence(input, ctx)).rejects.toThrow("invalid include");
  expect(call).toHaveBeenCalledTimes(3);
});

test("current-family apply consumes its reviewed hash, preserves receipts and recaptures native evidence", async () => {
  const doc = familyRouteState.schema.parse({});
  const entry = {
    familyId: 7,
    familyName: "Box",
    planHash: "h7",
    changes: [],
    runEffects: [],
    refusals: [],
  };
  const capture = {
    reading: { at: scope.document, version: "v2", observedAt: "2026-09-07T00:00:00Z" },
    familyName: "Box",
    modelJson: "{}",
    coverage: { parameters: "Read" },
    unmodeledCount: 0,
  };
  const model = { ...opened, composedContent: '{"parameters":{"Width":{"value":42}}}' };
  const applied = {
    receipts: [{ familyId: 7, success: true, converged: true, residue: [], errors: [] }],
    diagnostics: [],
  };
  const call = vi
    .spyOn(HostRpcCaller.prototype, "call")
    .mockResolvedValueOnce(capture as never)
    .mockResolvedValueOnce(model as never)
    .mockResolvedValueOnce({ families: [entry], diagnostics: [] } as never)
    .mockResolvedValueOnce(capture as never)
    .mockResolvedValueOnce(model as never)
    .mockResolvedValueOnce(applied as never)
    .mockResolvedValueOnce(capture as never);
  const ctx = {
    scope,
    getDoc: () => doc,
    setDoc: async (next: typeof doc) => {
      Object.assign(doc, next);
    },
  };
  const handlers = createFamilyCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" });
  await handlers.plan(
    { documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "box" } },
    ctx,
  );
  await expect(handlers.apply({ expectedPlanHash: "stale" }, ctx)).rejects.toThrow(
    "Review a valid",
  );
  expect(call).toHaveBeenCalledTimes(3);
  await handlers.apply({ expectedPlanHash: "h7" }, ctx);
  expect(call.mock.calls[5]).toEqual([
    "familyfoundry.apply",
    {
      patchJson: JSON.stringify({ patch: JSON.parse(model.composedContent) }),
      expectedPlanHashes: { 7: "h7" },
    },
  ]);
  expect(doc.plan).toBeNull();
  expect(doc.apply).toEqual(applied);
  expect(doc.evidence).toMatchObject({ modelJson: "{}", origin: "capture" });
  expect(familyRouteState.schema.parse(doc).apply).toEqual(applied);
  await expect(handlers.apply({ expectedPlanHash: "h7" }, ctx)).rejects.toThrow("Review a valid");
  expect(call).toHaveBeenCalledTimes(7);
});

test("expanded inherited edits cannot write local overrides or move staged edits to another file", async () => {
  const documentId = { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "box" };
  const doc = settingsRouteState.schema.parse({
    documentId,
    fields: { "/parameters/Width/value": { staged: { value: 12 } } },
  });
  const call = vi.spyOn(HostRpcCaller.prototype, "call").mockResolvedValue({
    ...opened,
    rawContent: '{"parameters":{"$include":"@local/_params/width"}}',
    dependencies: [],
  } as never);
  const ctx = {
    scope,
    getDoc: () => doc,
    setDoc: async (next: typeof doc) => {
      Object.assign(doc, next);
    },
  };
  const handlers = createSettingsCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" });
  await expect(handlers.save({}, ctx)).rejects.toThrow("shared fragment");
  await expect(
    handlers.open({ documentId: { ...documentId, relativePath: "_params/width" } }, ctx),
  ).rejects.toThrow("current document's edits");
  expect(call.mock.calls.every(([key]) => key === "settings.document.open")).toBe(true);
  expect(doc.documentId).toEqual(documentId);
  expect(doc.fields["/parameters/Width/value"].staged?.value).toBe(12);
});
