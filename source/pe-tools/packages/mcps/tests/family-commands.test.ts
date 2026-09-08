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
import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";

afterEach(() => vi.restoreAllMocks());
const scope = { kind: "document" as const, document: address("C:\\Models\\Test.rvt") };
const opened = {
  rawContent: '{"patch":{"parameters":{"$preset":"@local/_params/width"}}}',
  composedContent: '{"patch":{"parameters":{"Width":{"value":"24in"}}}}',
  validation: { isValid: true, issues: [] },
  metadata: { documentId: { stableId: "C:\\Settings\\width.json" }, versionToken: { value: "v1" } },
};

test("native fleet keeps the replacement receipt and requires a fresh no-op plan", async () => {
  const doc = familiesRouteState.schema.parse({});
  const executionOptions = { singleTransaction: false, suppressWarnings: true };
  const entry = {
    familyId: 1,
    familyName: "Box",
    planHash: "hash-1",
    changes: [{ section: "parameters", key: "Width", kind: "Modify" }],
    runEffects: [],
    refusals: [],
    warnings: [{ code: "FamilyEditWarning", severity: "Warning", message: "observed" }],
  };
  const failedEntry = { ...entry, familyId: 3, familyName: "Other", planHash: "hash-3" };
  const receipt = {
    familyId: 2,
    success: true,
    converged: true,
    residue: [],
    errors: [],
    artifactDirectory: "C:\\Evidence",
  };
  const failedReceipt = {
    familyId: 3,
    success: false,
    converged: false,
    residue: failedEntry.changes,
    errors: ["rolled back"],
    artifactDirectory: "C:\\Evidence",
  };
  const call = vi
    .spyOn(HostRpcCaller.prototype, "call")
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({ families: [entry, failedEntry], diagnostics: [] } as never)
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({
      receipts: [receipt, failedReceipt],
      diagnostics: [{ code: "BatchIssue", path: "$", message: "review receipts" }],
    } as never)
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({
      families: [{ ...entry, familyId: 2, planHash: "hash-2", changes: [] }],
      diagnostics: [],
    } as never);
  const ctx = {
    scope,
    getDoc: () => doc,
    setDoc: async (next: typeof doc) => {
      Object.assign(doc, next);
    },
  };
  const handlers = createFamiliesCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" });
  const planInput = familiesRouteState.commands.plan.input.parse({
    profilePath: "width",
    scope: { categoryNames: [], familyNames: ["Box", "Other"], placementScope: "AllLoaded" },
    executionOptions,
  });
  await handlers.plan(planInput, ctx);
  expect(() =>
    familiesRouteState.commands.plan.input.parse({
      profilePath: "width",
      executionOptions: { singleTransaction: false, invented: true },
    }),
  ).toThrow();
  expect(call.mock.calls[1]).toEqual([
    "familyfoundry.plan",
    { patchJson: opened.composedContent, executionOptions },
  ]);
  await expect(handlers.apply({ expectedPlanHashes: { "1": "stale" } }, ctx)).rejects.toThrow(
    "reviewed family plans",
  );
  expect(call).toHaveBeenCalledTimes(2);
  const input = familiesRouteState.commands.apply.input.parse({
    expectedPlanHashes: { "1": "hash-1", "3": "hash-3" },
  });
  await handlers.apply(input, ctx);
  expect(call.mock.calls[3]).toEqual([
    "familyfoundry.apply",
    {
      patchJson: opened.composedContent,
      expectedPlanHashes: { "1": "hash-1", "3": "hash-3" },
      executionOptions,
    },
  ]);
  expect(doc.apply?.receipts).toEqual([receipt, failedReceipt]);
  expect(doc.apply?.diagnostics[0]?.code).toBe("BatchIssue");
  expect(familiesRouteState.schema.parse(doc).apply?.receipts[1]?.residue).toEqual(
    failedEntry.changes,
  );
  expect(doc.plan).toBeNull();
  await expect(handlers.apply(input, ctx)).rejects.toThrow("Plan first");
  expect(call).toHaveBeenCalledTimes(4);
  await handlers.plan({ profilePath: "width", scope: { familyNames: ["Box"] } }, ctx);
  expect(doc.plan?.entries).toEqual([
    expect.objectContaining({ familyId: 2, changes: [], runEffects: [] }),
  ]);
  expect(familiesRouteState.schema.parse(doc).plan?.entries[0]?.warnings[0]?.code).toBe(
    "FamilyEditWarning",
  );
  await expect(handlers.apply({ expectedPlanHashes: {} }, ctx)).rejects.toThrow(
    "No included family has changes",
  );
  expect(call).toHaveBeenCalledTimes(6);
  expect(familiesRouteState.schema.parse(doc).apply).toBeNull();
});

test("fleet runtime blocks an unknown Apply until a successful native replan", async () => {
  let saved: unknown;
  const workspace = new RouteWorkspace({
    registrations: [{ spec: familiesRouteState, handlers: createFamiliesCommandHandlers() }],
    store: {
      getState: async () => structuredClone(saved),
      setState: async ({ value }) => {
        saved = structuredClone(value);
      },
    },
  });
  const read = () => workspace.read({ scope }, "families");
  const command = async (name: string, input: unknown) =>
    workspace.command(
      { scope },
      "families",
      "human",
      name,
      input,
      (await read())!.revision,
      crypto.randomUUID(),
    );
  const entry = {
    familyId: 1,
    familyName: "Box",
    planHash: "h1",
    changes: [{ section: "parameters", key: "Width", kind: "Modify" }],
    runEffects: [],
    refusals: [],
    warnings: [],
  };
  const call = vi
    .spyOn(HostRpcCaller.prototype, "call")
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({ families: [entry], diagnostics: [] } as never)
    .mockResolvedValueOnce(opened as never)
    .mockRejectedValueOnce(new Error("response lost"));
  const planInput = {
    profilePath: "width",
    scope: {
      categoryNames: [],
      familyNames: ["Box"],
      placementScope: "AllLoaded",
    },
  };
  const applyInput = { expectedPlanHashes: { "1": "h1" } };
  expect(await command("plan", planInput)).toMatchObject({ ok: true });
  expect(await command("apply", applyInput)).toMatchObject({ ok: false, error: "response lost" });
  expect(await read()).toMatchObject({ status: "outcomeUnknown" });
  expect(await command("apply", applyInput)).toMatchObject({ ok: false, kind: "refused" });
  expect(call).toHaveBeenCalledTimes(4);
  call.mockRejectedValueOnce(new Error("read failed"));
  expect(await command("plan", planInput)).toMatchObject({ ok: false });
  expect(await read()).toMatchObject({ status: "outcomeUnknown" });
  call
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({ families: [{ ...entry, planHash: "h2" }], diagnostics: [] } as never);
  expect(await command("plan", planInput)).toMatchObject({ ok: true });
  expect(await read()).toMatchObject({
    status: "ready",
    doc: { plan: { entries: [{ planHash: "h2" }] } },
  });
  call
    .mockResolvedValueOnce(opened as never)
    .mockResolvedValueOnce({ receipts: [], diagnostics: [] } as never);
  expect(await command("apply", { expectedPlanHashes: { "1": "h2" } })).toMatchObject({ ok: true });
  expect(await read()).toMatchObject({ status: "ready", doc: { plan: null } });
  expect(call).toHaveBeenCalledTimes(9);
});

test.each([undefined, "C:\\Sidecars"])(
  "native build resolves sidecars (%s), stores convergence and refuses invalid composition",
  async (modelDirectory) => {
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
      modelDirectory,
    };
    await handlers.build_evidence(input, ctx);
    expect(doc.build).toEqual(built);
    expect(doc.evidence).toBeUndefined();
    expect(call.mock.calls[1]).toEqual([
      "revit.apply.family-model",
      {
        modelJson: opened.composedContent,
        outputPath: built.outputPath,
        modelDirectory: modelDirectory ?? "C:\\Settings",
      },
    ]);
    await expect(handlers.build_evidence(input, ctx)).rejects.toThrow("invalid include");
    expect(call).toHaveBeenCalledTimes(3);
  },
);

test("current-family apply consumes its reviewed hash, preserves receipts and recaptures native evidence", async () => {
  const doc = familyRouteState.schema.parse({});
  const executionOptions = { optimizeTypeOperations: false };
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
    issues: [{ code: "FamilyEditWarning", severity: "Warning", message: "observed" }],
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
  const planInput = familyRouteState.commands.plan.input.parse({
    documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "box" },
    executionOptions,
  });
  await handlers.plan(planInput, ctx);
  expect(call.mock.calls[2]).toEqual([
    "familyfoundry.plan",
    {
      patchJson: JSON.stringify({ patch: JSON.parse(model.composedContent) }),
      executionOptions,
    },
  ]);
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
      executionOptions,
    },
  ]);
  expect(doc.plan).toBeNull();
  expect(doc.apply).toEqual(applied);
  expect(doc.evidence).toMatchObject({ modelJson: "{}", origin: "capture" });
  expect(familyRouteState.schema.parse(doc).evidence).toMatchObject({
    issues: [{ code: "FamilyEditWarning" }],
  });
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
