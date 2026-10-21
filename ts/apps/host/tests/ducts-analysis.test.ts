import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { unavailableShare } from "../src/machine.ts";
import { peRead, peDo, buildCapabilities } from "@pe/mcps";
import { withInvocationContext } from "@pe/runtime/context";
import { readRequestIdentity } from "../src/request-identity.ts";
import {
  admitAnonymousCall,
  currentCaller,
  mintContext,
  mintBrowserContext,
  retireContext,
  Refused,
} from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { emptyThreadHead } from "@pe/agent-contracts";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  ductsAnalysisRequestSchema,
  ductsAnalysisResponseSchema,
  ductsDocumentSchema,
  ductsApplyRequestArtifactSchema,
  ductsApplyInputSchema,
  ductsRouteState,
  type DuctPortPin,
} from "@pe/agent-contracts";
import { price, applyRequest } from "@pe/ducts-domain/pricing";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import {
  createDuctsAnalysis,
  ductsNativeRead,
  type DuctsAnalysisSources,
} from "../src/ducts-analysis.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Purpose fixture: one fan directly connected to a 100-CFM grille with a stated 0.08-in-wg drop.
 * The fan has no available-static rating. This is not a clipped customer model. */
function fixture() {
  const connector = (other: number): DuctSnapshot["nodes"][number]["connectors"][number] => ({
    index: 1,
    kind: "end",
    shape: "round",
    diameterIn: 8,
    size: "8",
    direction: "bidirectional",
    point: [0, 0, 0],
    connectedTo: { elementId: other, connector: 1 },
  });
  const snapshot: DuctSnapshot = {
    coordinateEncoding: "native-double",
    document: {
      title: "Purpose fixture",
      readAt: "2026-10-14T00:00:00Z",
      elapsedMs: 1,
      networkBasedCalculations: true,
    },
    groups: [
      {
        id: "g",
        rootIds: [1],
        classifications: ["SupplyAir"],
        systemNames: ["SA"],
        terminalCount: 1,
        elementCount: 1,
        loops: 0,
        issueIds: ["fan"],
      },
    ],
    nodes: [
      {
        id: 1,
        kind: "equipment",
        category: "Equipment",
        family: "Fan",
        type: "Fixture",
        levelId: null,
        point: [0, 0, 0],
        connectors: [connector(2)],
        facts: [],
      },
      {
        id: 2,
        kind: "terminal",
        category: "Terminal",
        family: "Grille",
        type: "Fixture",
        groupId: "g",
        levelId: null,
        point: [0, 0, 0],
        connectors: [connector(1)],
        facts: [
          { key: "flow", value: 100, unit: "cfm", provenance: "designer-stated" },
          { key: "space", text: "101 Office", unit: "", provenance: "revit-reported" },
        ],
        terminalDrop: { catalogDropInWg: 0.08, assignedPressureDropInWg: null, writable: false },
      },
    ],
    segments: [],
    levels: [],
    flows: [],
    layers: [],
    // Unit 1 is the base equipment of SA: a proposed fan (ducts-domain `unit-roles.ts`).
    systems: [{ name: "SA", baseEquipmentId: 1, sections: [] }],
    slots: {
      fanStatic: "FanStatic",
      fanFlow: "FanFlow",
      componentDrop: "Pressure Drop",
      fittingCoefficient: "Pe_C",
      terminalFlow: "PE_M_Grd_AirFlow",
    },
    issues: [
      {
        id: "fan",
        kind: "no-fan-static",
        elementId: 1,
        groupId: "g",
        note: "Fan rating absent",
      },
    ],
  };
  const root = mkdtempSync(join(tmpdir(), "pe-duct-analysis-"));
  roots.push(root);
  const target = { session: "fixture-incarnation", openId: "fixture-open" };
  let nativeReads = 0,
    resolutions = 0,
    workReads = 0,
    mark: number | null = null;
  const sources: DuctsAnalysisSources = {
    root,
    producer: {
      version: "purpose-1",
      lane: "dev",
      executablePath: "fixture-host",
      processId: 99,
      serviceName: "fixture-host",
      sourceRoot: "fixture-source",
      installedRoot: null,
    },
    marks: { observedSince: 0, changedAt: () => mark, subscribe: () => () => {} },
    resolve: async (target) => {
      resolutions++;
      return {
        target,
        title: "Purpose fixture",
        address: null,
        process: { pid: 123, startUtcUnixMs: 1 },
        provenance: { fixture: true },
      };
    },
    call: async (key) => {
      nativeReads++;
      return Response.json(
        key === "ducts.snapshot" ? snapshot : { tables: {}, missing: [], unsupported: [] },
        { headers: { "x-pe-native-request-id": `fixture-${nativeReads}` } },
      );
    },
    readWork: async () => {
      workReads++;
      return null;
    },
  };
  return {
    root,
    target,
    snapshot,
    sources,
    api: createDuctsAnalysis(sources),
    counts: () => ({ nativeReads, resolutions, workReads }),
    change: () => {
      mark = Date.now();
    },
  };
}
const read = (source: unknown, selector: unknown = { kind: "document" }, extra: object = {}) =>
  ductsAnalysisRequestSchema.parse({ source, selector, ...extra });

test("required demand does not need a known fan rating; evidence contains the exact effective inputs", async () => {
  const f = fixture();
  const result = ductsAnalysisResponseSchema.parse(
    await f.api.read(read({ kind: "fresh", target: f.target })),
  );
  expect(result.rows[0]).toMatchObject({
    id: 1,
    requiredEspNowInWg: 0.08,
    availableFanStaticInWg: null,
  });
  expect(result.completeness).toMatchObject({
    verdict: "complete",
    expectedTerminals: 1,
    pricedTerminals: 1,
  });
  expect(result.work.kind).toBe("observed-only");
  const artifact = JSON.parse(await (await f.api.artifact(result.analysisId)).text());
  expect(
    JSON.parse(gunzipSync(Buffer.from(artifact.input.data, "base64")).toString("utf8")).snapshot,
  ).toEqual(f.snapshot);
  expect(artifact.acquisition[0].headers["x-pe-native-request-id"]).toBe("fixture-1");
  expect(artifact.transportLabel).toContain("not original native");
});

test("historical selectors and pagination make zero acquisitions; corruption and wrong cursors refuse", async () => {
  const f = fixture();
  const initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  const before = f.counts();
  const source = { kind: "artifact", id: initial.analysisId };
  const terminal = await f.api.read(
    read(source, { kind: "terminal", id: 2 }, { projection: "terminals", limit: 1 }),
  );
  expect(terminal.rows[0]?.requiredEspNowInWg).toBe(0.08);
  const path = await f.api.read(read(source, { kind: "terminal", id: 2 }, { projection: "path" }));
  expect(path.rows[0]?.path).toMatchObject({
    terminalId: 2,
    componentKind: "terminal",
    lossInWg: 0.08,
    error: null,
  });
  expect(terminal.freshness.state).toBe("historical");
  const ambiguous = await f.api.read(read(source, { kind: "space-text", text: "101 office" }));
  expect(ambiguous.selection.state).toBe("ambiguous");
  expect(ambiguous.completeness.verdict).toBe("partial");
  expect(f.counts()).toEqual(before);
  await expect(
    f.api.read(
      read(source, { kind: "document" }, { cursor: { offset: 1, basis: "0".repeat(64) } }),
    ),
  ).rejects.toThrow("Cursor");
  const artifactPath = join(f.root, `${initial.analysisId}.json`);
  writeFileSync(artifactPath, readFileSync(artifactPath, "utf8") + " ");
  await expect(f.api.read(read(source))).rejects.toThrow("integrity");
});

test("an intervening mark and unknown drops prevent a complete demand verdict", async () => {
  const f = fixture();
  f.snapshot.nodes[1]!.terminalDrop = null;
  const original = f.sources.call;
  f.sources.call = async (...args) => {
    const response = await original(...args);
    f.change();
    return response;
  };
  const result = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(result.freshness.state).toBe("changed");
  expect(result.completeness.verdict).toBe("partial");
  expect(result.completeness.pricedTerminals).toBe(0);
});

test("a stale exact target refuses before any native read", async () => {
  const f = fixture();
  f.sources.resolve = async () => {
    throw Error("exact attachment unavailable");
  };
  await expect(f.api.read(read({ kind: "fresh", target: f.target }))).rejects.toThrow(
    "exact attachment",
  );
  expect(f.counts().nativeReads).toBe(0);
});

test("a present passive equipment node stays in inventory with unknown demand", async () => {
  const f = fixture();
  f.snapshot.nodes.push({ ...f.snapshot.nodes[0]!, id: 3, connectors: [] });
  const initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(initial.coverage.equipment).toBe(2);
  expect(initial.rows.map((row) => row.id)).toEqual([1, 3]);
  const passive = await f.api.read(
    read({ kind: "artifact", id: initial.analysisId }, { kind: "equipment", id: 3 }),
  );
  expect(passive.selection.state).toBe("matched");
  expect(passive.rows[0]?.requiredEspNowInWg).toBeNull();
  expect(passive.completeness.verdict).toBe("partial");
});

test("an implicit connector zero is unknown; explicitly stated zero remains known", async () => {
  const f = fixture();
  f.snapshot.nodes[1]!.terminalDrop = {
    assignedPressureDropInWg: 0,
    connectorLossMethod: "NotDefined",
    writable: false,
  };
  const implicit = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(implicit.completeness.verdict).toBe("partial");
  expect(implicit.completeness.reasons.map((reason) => reason.code)).toContain(
    "terminal-drop-authority",
  );
  f.snapshot.nodes[1]!.terminalDrop!.connectorLossMethod = "SpecificLoss";
  const assigned = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(assigned.completeness.verdict).toBe("partial");
  f.snapshot.nodes[1]!.terminalDrop!.catalogDropInWg = 0;
  const stated = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(stated.completeness.verdict).toBe("complete");
  expect(stated.rows[0]?.requiredEspStagedInWg).toBe(0);
  // Catalog zero above is a contract fixture: today's native Converted() filters zero out.
  // An explicit staged zero exercises the source the shipped native collector cannot return.
  f.snapshot.nodes[1]!.terminalDrop!.catalogDropInWg = null;
  f.sources.readWork = async () => ({
    revision: 1,
    doc: ductsDocumentSchema.parse({
      terminalDrops: {
        "2": { staged: { value: { inWg: 0, source: "Purpose fixture explicit zero" } } },
      },
    }),
  });
  const staged = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(staged.completeness.verdict).toBe("complete");
  expect(staged.rows[0]?.requiredEspStagedInWg).toBe(0);
});

test("an unreadable applied store and unresolved physical fan circuits stay partial", async () => {
  const f = fixture();
  f.snapshot.storeError = "Invalid model store";
  f.snapshot.groups[0]!.classifications = ["SupplyAir", "ExhaustAir"];
  const result = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(result.rows[0]?.requiredEspNowInWg).toBeNull();
  expect(result.rows[0]?.classificationParts).toHaveLength(1);
  expect(result.completeness.reasons.map((reason) => reason.code)).toEqual(
    expect.arrayContaining(["unreadable-model-store", "unresolved-fan-circuits"]),
  );
});

test("the declared host route reads canonical Work and unreadable Work refuses before acquisition", async () => {
  const f = fixture();
  const resolve = f.sources.resolve;
  f.sources.resolve = async (target) => ({ ...(await resolve(target)), address: "C:/fixture.rvt" });
  let unreadable = false;
  let writes = 0;
  const routes = createPeRoutes({
    registrations: [{ spec: ductsRouteState, handlers: {} }],
    heads: { observe: () => () => {} },
    store: {
      getState: async () => {
        if (unreadable) throw Error("Unreadable fixture Work");
        return { version: 1, revision: 7, doc: ductsDocumentSchema.parse({}) };
      },
      setState: async () => {
        writes++;
      },
    },
    ductsAnalysis: f.sources,
  });
  const request = () =>
    new Request("http://local/pe/ducts/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { kind: "fresh", target: f.target },
        selector: { kind: "document" },
      }),
    });
  const response = await routes.fetch(request());
  expect(response.status).toBe(200);
  const result = ductsAnalysisResponseSchema.parse(await response.json());
  expect(result.work).toEqual({ kind: "canonical", revision: 7 });
  const asset = await routes.fetch(new Request(`http://local${result.artifact.url}`));
  expect(asset.status).toBe(200);
  expect(JSON.parse(await asset.text()).work.key.target).toBe("C:/fixture.rvt");
  const counts = f.counts();
  unreadable = true;
  const refused = await routes.fetch(request());
  expect(refused.status).toBe(409);
  expect(await refused.text()).toContain("Unreadable fixture Work");
  expect(f.counts().nativeReads).toBe(counts.nativeReads);
  expect(writes).toBe(0);
});

test("saved Work in an old shape degrades: the price runs, readable cells are kept, the broken ones are named in a finding", async () => {
  const f = fixture();
  f.sources.readWork = async () => ({
    revision: 4,
    doc: {
      // The pre-8b46f3ad subject: one cell, not a record by group id.
      subject: { g1: { staged: { value: "old shape" } } },
      flows: { "2": { staged: { value: { cfm: 150, source: "fixture" } } } },
      unitStatics: { "1": { staged: { value: { inWg: 0.5 } } } },
    },
  });
  const result = ductsAnalysisResponseSchema.parse(
    await f.api.read(read({ kind: "fresh", target: f.target })),
  );
  expect(result.rows.length).toBeGreaterThan(0);
  const finding = result.findings.find((item) => item.kind === "unreadable-work");
  expect(finding).toMatchObject({ clearer: "person", elementIds: [] });
  expect(finding?.note).toContain("press Start fresh");
  expect(finding?.note).toContain("subject.g1");
  expect(finding?.note).toContain("unitStatics");
  expect(finding?.note).not.toContain("flows");
  expect(result.findingCounts.byKind["unreadable-work"]).toBe(1);
  // An unreadable envelope degrades the same way.
  f.sources.readWork = async () => ({ revision: 0, doc: null });
  const whole = await f.api.read(read({ kind: "fresh", target: f.target }));
  expect(whole.findings.find((item) => item.kind === "unreadable-work")?.note).toContain(
    "(whole document)",
  );
});

test("an equipment row exposes its tag so a name like FC-23 can be matched", async () => {
  const f = fixture();
  f.snapshot.nodes[0]!.label = "FC-23";
  const result = ductsAnalysisResponseSchema.parse(
    await f.api.read(read({ kind: "fresh", target: f.target })),
  );
  expect(result.rows.find((row) => row.id === 1)?.tag).toBe("FC-23");
});

test("physical circuits and path pages retain staged evidence and never acquire again historically", async () => {
  const f = fixture();
  for (const node of f.snapshot.nodes) node.uniqueId = `purpose-${node.id}`;
  const pin = (id: number): DuctPortPin => ({
    index: 1,
    point: [0, 0, 0],
    shape: "round",
    diameterIn: 8,
    widthIn: null,
    heightIn: null,
    direction: "bidirectional",
    connectedTo: { id: id === 1 ? 2 : 1, connector: 1, uniqueId: `purpose-${id === 1 ? 2 : 1}` },
  });
  const doc = ductsDocumentSchema.parse({
    calculation: {
      scenario: {
        staged: { value: { kind: "balanced-design", source: "Purpose balanced design" } },
      },
      fan: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 1, uniqueId: "purpose-1" },
            inlet: null,
            outlet: pin(1),
            referenceTotalPressureInWg: 0,
            designFlowCfm: null,
            source: "Purpose external-plane role",
          },
        },
      },
      terminal: {
        staged: {
          value: {
            kind: "terminal",
            element: { id: 2, uniqueId: "purpose-2" },
            port: pin(2),
            role: "demand",
            flowCfm: null,
            boundaryTotalPressureInWg: 0,
            loss: {
              totalLossInWg: 0.08,
              flowCfm: 100,
              source: "Purpose explicitly stated TOTAL loss",
            },
            source: "Purpose room reference",
          },
        },
      },
    },
  });
  f.sources.readWork = async () => ({ doc, revision: 9 });
  const fresh = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "fresh", target: f.target },
        { kind: "equipment", id: 1 },
        { projection: "circuits", limit: 1 },
      ),
    ),
  );
  expect(fresh.rows).toHaveLength(1);
  expect(fresh.rows[0]).toMatchObject({
    kind: "circuit",
    requiredEspStagedInWg: null,
    circuit: {
      id: "fan",
      status: "complete-for-declared-design",
      requiredExternalTotalPressureInWg: 0.08,
      manufacturerEsp: null,
    },
  });
  const artifact = JSON.parse(await (await f.api.artifact(fresh.analysisId)).text());
  expect(artifact.format).toBe("ducts-analysis-v5");
  expect(
    JSON.parse(gunzipSync(Buffer.from(artifact.input.data, "base64")).toString("utf8")).work,
  ).toEqual(doc);
  expect(artifact.outputs.next.design.graph.ports).toHaveLength(2);
  const counts = f.counts();
  const historical = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "artifact", id: fresh.analysisId },
        { kind: "terminal", id: 2 },
        { projection: "circuit-path", limit: 1 },
      ),
    ),
  );
  expect(historical.rows[0]).toMatchObject({
    kind: "path",
    path: { circuitId: "fan", circuitSide: "outlet", terminalId: 2, lossInWg: 0.08 },
  });
  expect(f.counts()).toEqual(counts);
  const summary = await f.api.read(read({ kind: "artifact", id: fresh.analysisId }));
  expect(summary.rows[0]?.requiredEspStagedInWg).toBeNull();
  expect(summary.rows[0]?.classificationParts).toEqual([]);
  const ports = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "artifact", id: fresh.analysisId },
        { kind: "document" },
        { projection: "ports", limit: 1 },
      ),
    ),
  );
  expect(ports.page).toMatchObject({ total: 2, returned: 1, truncated: true });
  expect(ports.rows[0]?.port).toMatchObject({
    uniqueId: "purpose-1",
    pin: pin(1),
    origin: "native-snapshot",
    reciprocal: true,
  });
  const second = await f.api.read(
    read(
      { kind: "artifact", id: fresh.analysisId },
      { kind: "document" },
      { projection: "ports", limit: 1, cursor: ports.page.nextCursor },
    ),
  );
  expect(second.rows[0]?.id).toBe(2);
  expect(f.counts()).toEqual(counts);
  await expect(
    f.api.read(
      read(
        { kind: "artifact", id: fresh.analysisId },
        { kind: "equipment", id: 1 },
        { projection: "ports", limit: 1, cursor: ports.page.nextCursor },
      ),
    ),
  ).rejects.toThrow("Cursor does not belong");
});

test("port evidence exposes missing identity and half-joints without manufacturing admissible pins", async () => {
  for (const missingIdentity of [true, false]) {
    const f = fixture();
    if (!missingIdentity) {
      for (const n of f.snapshot.nodes) n.uniqueId = `purpose-${n.id}`;
      f.snapshot.nodes[1]!.connectors[0]!.connectedTo = null;
    }
    const result = ductsAnalysisResponseSchema.parse(
      await f.api.read(
        read(
          { kind: "fresh", target: f.target },
          { kind: "equipment", id: 1 },
          { projection: "ports" },
        ),
      ),
    );
    expect(result.rows[0]?.port?.pin).toBeNull();
    expect(result.rows[0]?.port?.reason).toContain(
      missingIdentity ? "identity missing" : "not reciprocal",
    );
    expect(result.rows[0]?.port?.connection).toEqual({ elementId: 2, connector: 1 });
  }
});

test("MCP analysis retains admitted caller through the real route and nested native reads", async () => {
  const f = fixture();
  const base = "http://127.0.0.1:5180";
  const token = mintContext({ kind: "pea", thread: "analysis-context-test" });
  const options = {
    port: () => 5180,
    frontendOrigin: () => undefined,
    share: { ...unavailableShare, observe: () => {} },
  };
  const seen: string[] = [];
  let retainedAnalysis = "";
  const routes = createPeRoutes({
    registrations: [{ spec: ductsRouteState, handlers: {} }],
    heads: { observe: () => () => {} },
    store: {
      getState: async () => ({ version: 1, revision: 7, doc: candidateWork() }),
      setState: async () => {},
    },
    ductsAnalysis: { ...f.sources, call: ductsNativeRead(base) },
  });
  vi.stubEnv("PE_CONTEXT", "");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers);
    headers.host = url.host;
    const identity = await readRequestIdentity(headers, url.pathname, options, request.method);
    if ("refusal" in identity) return Response.json(identity, { status: 403 });
    return withInvocationContext({ ...identity, hostBaseUrl: base }, async () => {
      if (url.pathname === "/pe/scope/self")
        return Response.json({ thread: "analysis-context-test", ...emptyThreadHead });
      if (url.pathname === "/pe/capabilities")
        return Response.json({
          at: new Date().toISOString(),
          machine: machineFixture(),
          sources: {},
          diagnostics: [],
          capabilities: buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }),
        });
      if (url.pathname === "/pe/ducts/analysis") {
        const response = await routes.fetch(request);
        const body = await response.clone().json();
        retainedAnalysis = body.analysisId;
        return response;
      }
      if (url.pathname === "/call") {
        const body = (await request.json()) as { key: string };
        try {
          admitAnonymousCall(currentCaller(), body.key);
        } catch (error) {
          if (error instanceof Refused) return Response.json(error.refusal, { status: 403 });
          throw error;
        }
        expect(request.headers.get("x-pe-context")).toBe(token);
        expect(request.headers.get("x-pe-bridge-session-id")).toBe(f.target.session);
        expect(request.headers.get("x-pe-open-document-id")).toBe(f.target.openId);
        seen.push(body.key);
        return Response.json(
          body.key === "ducts.snapshot" ? f.snapshot : { tables: {}, missing: [], unsupported: [] },
        );
      }
      throw Error(`Unexpected fixture URL ${url.pathname}`);
    });
  });
  try {
    const input = {
      key: "route:ducts.analysis",
      input: { source: { kind: "fresh", target: f.target }, selector: { kind: "document" } },
    };
    for (const execute of [
      () =>
        peRead.execute(peRead.inputSchema.parse(input), { agent: { toolCallId: "fixture-read" } }),
      () => peDo.execute(peDo.inputSchema.parse(input), { agent: { toolCallId: "fixture-do" } }),
    ]) {
      const result = await withInvocationContext(
        { hostBaseUrl: base, headers: { "x-pe-context": token } },
        execute,
      );
      expect(result).toMatchObject({ ok: true, result: { target: f.target } });
    }
    expect(seen).toEqual(["ducts.snapshot", "ducts.tables", "ducts.snapshot", "ducts.tables"]);
    const candidateInput = {
      key: "route:ducts.analysis",
      input: {
        source: { kind: "artifact", id: retainedAnalysis },
        selector: { kind: "document" },
        projection: "apply-request",
      },
    };
    const candidate = await withInvocationContext(
      { hostBaseUrl: base, headers: { "x-pe-context": token } },
      () =>
        peRead.execute(peRead.inputSchema.parse(candidateInput), {
          agent: { toolCallId: "fixture-plan" },
        }),
    );
    expect(candidate).toMatchObject({
      ok: true,
      result: {
        applyRequest: {
          mode: "historical-candidate-requires-approval-and-revalidation",
          counts: { terminals: 1 },
        },
      },
    });
    expect(seen).toEqual(["ducts.snapshot", "ducts.tables", "ducts.snapshot", "ducts.tables"]);
  } finally {
    retireContext(token);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("browser human analysis retains its admitted identity through nested native reads", async () => {
  const f = fixture();
  const base = "http://127.0.0.1:5180";
  const options = {
    port: () => 5180,
    frontendOrigin: () => undefined,
    share: { ...unavailableShare, observe: () => {} },
  };
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const routes = createPeRoutes({
    registrations: [],
    heads: { observe: () => () => {} },
    store: { getState: async () => null, setState: async () => {} },
    ductsAnalysis: { ...f.sources, call: ductsNativeRead(base) },
  });
  const seen: string[] = [];
  vi.stubEnv("PE_CONTEXT", "");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const identity = await readRequestIdentity(
      { ...Object.fromEntries(request.headers), host: url.host },
      url.pathname,
      options,
      request.method,
    );
    if ("refusal" in identity) return Response.json(identity, { status: 403 });
    return withInvocationContext({ ...identity, hostBaseUrl: base }, async () => {
      expect(currentCaller()).toMatchObject({ kind: "human", via: "local" });
      expect(request.headers.get("cookie")).toBe(cookie);
      expect(request.headers.has("x-pe-context")).toBe(false);
      const body = (await request.json()) as { key: string };
      admitAnonymousCall(currentCaller(), body.key);
      seen.push(body.key);
      return Response.json(
        body.key === "ducts.snapshot" ? f.snapshot : { tables: {}, missing: [], unsupported: [] },
      );
    });
  });
  try {
    const initial = new Request(`${base}/pe/ducts/analysis`, {
      method: "POST",
      headers: {
        origin: base,
        referer: `${base}/ducts`,
        cookie: `${cookie}; unrelated=do-not-forward`,
        "x-pe-runtime-service": hostOwnership.serviceName,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: { kind: "fresh", target: f.target },
        selector: { kind: "document" },
      }),
    });
    const identity = await readRequestIdentity(
      { ...Object.fromEntries(initial.headers), host: "127.0.0.1:5180" },
      "/pe/ducts/analysis",
      options,
      "POST",
    );
    if ("refusal" in identity) throw Error(identity.refusal.code);
    expect(identity.caller.kind).toBe("human");
    const response = await withInvocationContext({ ...identity, hostBaseUrl: base }, () =>
      routes.fetch(initial),
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual(["ducts.snapshot", "ducts.tables"]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("component flow projection is canonical, bounded and historical", async () => {
  const f = fixture();
  const initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  const counts = f.counts();
  const response = await f.api.read(
    read(
      { kind: "artifact", id: initial.analysisId },
      { kind: "document" },
      { projection: "flows", limit: 1 },
    ),
  );
  expect(response.rows).toHaveLength(1);
  expect(response.rows[0]?.flow).toMatchObject({ kind: "joint", signedCfm: null });
  expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(65536);
  expect(response.rows[0]).not.toHaveProperty("componentWitness");
  expect(f.counts()).toEqual(counts);
});

test("canonical staged component constraints drive shared analysis without claiming pressure completion", async () => {
  const f = fixture(),
    owner = f.snapshot.nodes[0]!;
  const makePort = (index: number, id: number, connector: number) => ({
    ...owner.connectors[0]!,
    index,
    connectedTo: { elementId: id, connector },
  });
  f.snapshot.nodes = [
    { ...owner, id: 1, uniqueId: "flow-1", connectors: [makePort(0, 4, 0)] },
    { ...owner, id: 3, uniqueId: "flow-3", connectors: [makePort(0, 4, 1)] },
    {
      ...owner,
      id: 4,
      uniqueId: "flow-4",
      kind: "fitting",
      connectors: [makePort(0, 1, 0), makePort(1, 3, 0), makePort(2, 2, 0)],
    },
    { ...f.snapshot.nodes[1]!, id: 2, uniqueId: "flow-2", connectors: [makePort(0, 4, 2)] },
  ];
  const resolve = f.sources.resolve;
  f.sources.resolve = async (target) => ({
    ...(await resolve(target)),
    address: "C:/flow-fixture.rvt",
  });
  const pin = (id: number, index: number): DuctPortPin => {
    const p = f.snapshot.nodes.find((n) => n.id === id)!.connectors.find((p) => p.index === index)!;
    return {
      index,
      point: [0, 0, 0],
      shape: "round",
      diameterIn: 8,
      widthIn: null,
      heightIn: null,
      direction: p.direction,
      connectedTo: {
        id: p.connectedTo!.elementId,
        uniqueId: `flow-${p.connectedTo!.elementId}`,
        connector: p.connectedTo!.connector,
      },
    };
  };
  const doc = ductsDocumentSchema.parse({
    calculation: {
      scenario: { staged: { value: { kind: "balanced-design", source: "Synthetic design" } } },
      a: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 1, uniqueId: "flow-1" },
            inlet: null,
            outlet: pin(1, 0),
            designFlowCfm: 100,
            referenceTotalPressureInWg: 0,
            source: "Synthetic100",
          },
        },
      },
      b: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 3, uniqueId: "flow-3" },
            inlet: null,
            outlet: pin(3, 0),
            designFlowCfm: 200,
            referenceTotalPressureInWg: 0,
            source: "Synthetic200",
          },
        },
      },
      t: {
        staged: {
          value: {
            kind: "terminal",
            element: { id: 2, uniqueId: "flow-2" },
            port: pin(2, 0),
            role: "demand",
            flowCfm: 300,
            boundaryTotalPressureInWg: 0,
            loss: null,
            source: "Synthetic300",
          },
        },
      },
    },
  });
  f.sources.readWork = async () => ({ doc, revision: 1 });
  const baseline = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
  );
  const raw = JSON.parse(await (await f.api.artifact(baseline.analysisId)).text());
  expect(baseline.rows[0]!.component?.status).toBe("underdetermined");
  const design = {
    kind: "component-flow",
    hydraulics: null,
    componentWitness: raw.outputs.next.design.componentFlows[0].witnessElements.map(
      (index: number) => raw.witnessElements[index],
    ),
    constraints: [
      {
        element: { id: 2, uniqueId: "flow-2" },
        port: pin(2, 0),
        signedCfm: -300,
        source: "Explicit signed300 withdrawal",
      },
    ],
    source: "One component design",
  };
  let staged = ductsDocumentSchema.parse({
    ...doc,
    calculation: { ...doc.calculation, flow: { proposal: { value: design } } },
  });
  f.sources.readWork = async () => ({ doc: staged, revision: 2 });
  const proposal = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
  );
  expect(proposal.rows[0]!.component?.status).toBe("underdetermined");
  staged = ductsDocumentSchema.parse({
    ...doc,
    calculation: { ...doc.calculation, flow: { staged: { value: design } } },
  });
  const fresh = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "fresh", target: f.target },
        { kind: "document" },
        { projection: "flows", limit: 100 },
      ),
    ),
  );
  expect(
    fresh.rows
      .filter((r) => r.flow?.kind === "joint")
      .map((r) => Math.abs(r.flow!.signedCfm!))
      .sort((a, b) => a - b),
  ).toEqual([100, 200, 300]);
  const before = f.counts();
  const historical = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "artifact", id: fresh.analysisId },
        { kind: "document" },
        { projection: "flows", limit: 100 },
      ),
    ),
  );
  expect(historical.rows).toEqual(fresh.rows);
  expect(f.counts()).toEqual(before);
  const circuits = await f.api.read(
    read(
      { kind: "artifact", id: fresh.analysisId },
      { kind: "document" },
      { projection: "circuits" },
    ),
  );
  expect(
    circuits.rows.every(
      (r) =>
        r.circuit?.status === "partial" && r.circuit.requiredExternalTotalPressureInWg === null,
    ),
  ).toBe(true);
});
test("analysis pages obey byte budget and preserve complete historical row coverage", async () => {
  const f = fixture(),
    owner = f.snapshot.nodes[0]!;
  for (let i = 3; i < 23; i++)
    f.snapshot.nodes.push({
      ...owner,
      id: i,
      uniqueId: `large-${i}`,
      family: "X".repeat(10000),
      connectors: [],
    });
  const first = await f.api.read(
    read(
      { kind: "fresh", target: f.target },
      { kind: "document" },
      { projection: "summary", limit: 100 },
    ),
  );
  expect(first.rows.length).toBeLessThan(21);
  expect(first.page.nextCursor).not.toBeNull();
  const ids = first.rows.map((r) => r.id);
  let cursor = first.page.nextCursor;
  while (cursor) {
    const page = await f.api.read(
      read(
        { kind: "artifact", id: first.analysisId },
        { kind: "document" },
        { projection: "summary", limit: 100, cursor },
      ),
    );
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(65536);
    ids.push(...page.rows.map((r) => r.id));
    cursor = page.page.nextCursor;
  }
  expect(new Set(ids).size).toBe(21);
  expect(ids).toHaveLength(21);
  f.snapshot.nodes[0]!.family = "X".repeat(70000);
  await expect(f.api.read(read({ kind: "fresh", target: f.target }))).rejects.toThrow(
    /65536-byte budget.*artifact/,
  );
});

test("artifact v5 interns witness records without merging different role partitions", async () => {
  const f = fixture();
  for (const n of f.snapshot.nodes) n.uniqueId = `purpose-${n.id}`;
  const pin = (id: number): DuctPortPin => ({
    index: 1,
    point: [0, 0, 0],
    shape: "round",
    diameterIn: 8,
    widthIn: null,
    heightIn: null,
    direction: "bidirectional",
    connectedTo: { id: id === 1 ? 2 : 1, uniqueId: `purpose-${id === 1 ? 2 : 1}`, connector: 1 },
  });
  const doc = ductsDocumentSchema.parse({
    calculation: {
      scenario: { staged: { value: { kind: "balanced-design", source: "Purpose design" } } },
      fan: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 1, uniqueId: "purpose-1" },
            inlet: null,
            outlet: pin(1),
            designFlowCfm: 100,
            referenceTotalPressureInWg: 0,
            source: "Purpose fan",
          },
        },
      },
      t: {
        staged: {
          value: {
            kind: "terminal",
            element: { id: 2, uniqueId: "purpose-2" },
            port: pin(2),
            role: "demand",
            flowCfm: 100,
            boundaryTotalPressureInWg: 0,
            loss: { flowCfm: 100, totalLossInWg: 0, source: "Explicit zero TOTAL" },
            source: "Purpose terminal",
          },
        },
      },
    },
  });
  f.sources.readWork = async () => ({ doc, revision: 1 });
  const response = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
  );
  const artifact = JSON.parse(await (await f.api.artifact(response.analysisId)).text());
  expect(artifact.format).toBe("ducts-analysis-v5");
  expect(artifact.witnessElements.length).toBeGreaterThan(2);
  const now = artifact.outputs.now.design.componentFlows[0],
    next = artifact.outputs.next.design.componentFlows[0];
  expect(now).not.toHaveProperty("componentWitness");
  expect(next).not.toHaveProperty("componentWitness");
  const nw = now.witnessElements.map((i: number) => artifact.witnessElements[i]);
  const sw = next.witnessElements.map((i: number) => artifact.witnessElements[i]);
  expect(nw[0].rolePartitions).toEqual([]);
  expect(sw[0].rolePartitions).toEqual(["fan:reservoir->1"]);
  expect(now.witnessElements[0]).not.toBe(next.witnessElements[0]);
  const before = f.counts();
  const historical = await f.api.read(
    read(
      { kind: "artifact", id: response.analysisId },
      { kind: "document" },
      { projection: "components" },
    ),
  );
  expect(historical.rows).toEqual(response.rows);
  expect(f.counts()).toEqual(before);
});

test("v5 rejects invalid witness references and old projection versions while raw bytes remain exact", async () => {
  const f = fixture();
  const fresh = await f.api.read(read({ kind: "fresh", target: f.target }));
  const artifact = JSON.parse(await (await f.api.artifact(fresh.analysisId)).text());
  const save = (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const id = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(f.root, `${id}.json`), bytes);
    return { id, bytes };
  };
  const before = f.counts();
  for (const format of ["ducts-analysis-v3", "ducts-analysis-v4"]) {
    const legacy = save({ ...artifact, format });
    expect(Buffer.from(await (await f.api.artifact(legacy.id)).arrayBuffer())).toEqual(
      legacy.bytes,
    );
    await expect(f.api.read(read({ kind: "artifact", id: legacy.id }))).rejects.toThrow(
      /Unsupported analysis format/,
    );
  }
  const invalid = structuredClone(artifact);
  invalid.outputs.next.design.componentFlows[0].witnessElements[0] =
    artifact.witnessElements.length;
  const broken = save(invalid);
  await expect(f.api.read(read({ kind: "artifact", id: broken.id }))).rejects.toThrow(
    /witness reference is invalid/,
  );
  expect(f.counts()).toEqual(before);
});

test("historical v5 rounded-coordinate results remain stored evidence without acquiring or recomputing native-double geometry", async () => {
  const f = fixture(),
    fresh = await f.api.read(
      read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
    );
  const artifact = JSON.parse(await (await f.api.artifact(fresh.analysisId)).text());
  const input = JSON.parse(gunzipSync(Buffer.from(artifact.input.data, "base64")).toString("utf8"));
  delete input.snapshot.coordinateEncoding;
  for (const segment of input.snapshot.segments) delete segment.curveKind;
  const inputJson = JSON.stringify(input);
  artifact.input.data = gzipSync(Buffer.from(inputJson)).toString("base64");
  artifact.input.byteSize = Buffer.byteLength(inputJson);
  artifact.input.sha256 = createHash("sha256").update(inputJson).digest("hex");
  for (const w of artifact.witnessElements) {
    delete w.coordinateEncoding;
    delete w.curveKind;
  }
  const bytes = Buffer.from(JSON.stringify(artifact)),
    id = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(f.root, `${id}.json`), bytes);
  const before = f.counts(),
    historical = await f.api.read(
      read({ kind: "artifact", id }, { kind: "document" }, { projection: "components" }),
    );
  expect(historical.rows).toEqual(fresh.rows);
  expect(f.counts()).toEqual(before);
  expect(Buffer.from(await (await f.api.artifact(id)).arrayBuffer())).toEqual(bytes);
});

test("v5 stores exact effective UTF8 input in bounded gzip-base64", async () => {
  const f = fixture();
  const response = await f.api.read(read({ kind: "fresh", target: f.target }));
  const artifact = JSON.parse(await (await f.api.artifact(response.analysisId)).text());
  expect(artifact.format).toBe("ducts-analysis-v5");
  expect(artifact.input.encoding).toBe("gzip-base64");
});

test("v5 rejects malformed input bytes before JSON parsing and never reacquires historical data", async () => {
  const f = fixture();
  const fresh = await f.api.read(read({ kind: "fresh", target: f.target }));
  const original = JSON.parse(await (await f.api.artifact(fresh.analysisId)).text());
  const before = f.counts();
  const cases = [
    { ...original.input, encoding: "utf8" },
    { ...original.input, data: original.input.data + "\n" },
    { ...original.input, data: "Zh==" },
    { ...original.input, data: Buffer.from("not gzip").toString("base64") },
    { ...original.input, sha256: "0".repeat(64) },
    { ...original.input, byteSize: original.input.byteSize + 1 },
    { ...original.input, byteSize: 1 },
    { ...original.input, byteSize: 67108865 },
    {
      encoding: "gzip-base64",
      data: gzipSync(Buffer.from([0xff])).toString("base64"),
      byteSize: 1,
      sha256: createHash("sha256")
        .update(Buffer.from([0xff]))
        .digest("hex"),
    },
  ];
  for (const input of cases) {
    const bytes = Buffer.from(JSON.stringify({ ...original, input }));
    const id = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(f.root, `${id}.json`), bytes);
    await expect(f.api.read(read({ kind: "artifact", id }))).rejects.toThrow(/effective-input/);
  }
  expect(f.counts()).toEqual(before);
  const raw = gunzipSync(Buffer.from(original.input.data, "base64"));
  expect(raw.length).toBe(original.input.byteSize);
  expect(createHash("sha256").update(raw).digest("hex")).toBe(original.input.sha256);
  expect(JSON.parse(raw.toString("utf8")).snapshot).toEqual(f.snapshot);
});

test("actual analysis handler shares bounded prescribed hydraulic closure and exact historical evidence", async () => {
  const f = fixture();
  for (const n of f.snapshot.nodes) n.uniqueId = `purpose-${n.id}`;
  f.snapshot.nodes[1]!.connectors[0]!.direction = "in";
  const port = (id: number) => {
    const n = f.snapshot.nodes.find((n) => n.id === id)!,
      c = n.connectors[0]!;
    return {
      index: c.index,
      point: c.point,
      shape: c.shape,
      diameterIn: c.diameterIn ?? null,
      widthIn: null,
      heightIn: null,
      direction: c.direction,
      connectedTo: { id: id === 1 ? 2 : 1, uniqueId: `purpose-${id === 1 ? 2 : 1}`, connector: 1 },
    };
  };
  let doc = ductsDocumentSchema.parse({
    calculation: {
      scenario: { staged: { value: { kind: "balanced-design", source: "Purpose design" } } },
      fan: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 1, uniqueId: "purpose-1" },
            inlet: null,
            outlet: port(1),
            designFlowCfm: 100,
            referenceTotalPressureInWg: 0,
            source: "Purpose fan",
          },
        },
      },
      terminal: {
        staged: {
          value: {
            kind: "terminal",
            element: { id: 2, uniqueId: "purpose-2" },
            port: port(2),
            role: "demand",
            flowCfm: 100,
            boundaryTotalPressureInWg: 0,
            loss: { flowCfm: 100, totalLossInWg: 0.08, source: "Purpose TOTAL" },
            source: "Purpose terminal",
          },
        },
      },
    },
  });
  f.sources.readWork = async () => ({ doc, revision: 1 });
  const initial = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
  );
  const first = JSON.parse(await (await f.api.artifact(initial.analysisId)).text());
  const witness = first.outputs.next.design.componentFlows[0].witnessElements.map(
    (i: number) => first.witnessElements[i],
  );
  doc = ductsDocumentSchema.parse({
    ...doc,
    calculation: {
      ...doc.calculation,
      pressure: {
        staged: {
          value: {
            kind: "component-flow",
            componentWitness: witness,
            constraints: [],
            hydraulics: {
              mode: "prescribed-flow-demand",
              anchors: [],
              laws: [],
              stationEquivalences: [],
              fanAllocations: [],
              source: "Purpose pressure closure",
            },
            source: "Purpose component",
          },
        },
      },
    },
  });
  const response = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
    ),
  );
  expect(response.rows[0]!.component?.hydraulics).toMatchObject({
    status: "complete-for-prescribed-flow",
    maxPressureResidualInWg: 0,
    fanHeadCount: 1,
    unknownFanHeads: 0,
    fanHeads: [expect.objectContaining({ requiredExternalTotalPressureInWg: 0.08 })],
  });
  expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(65536);
  const before = f.counts(),
    saved = Buffer.from(await (await f.api.artifact(response.analysisId)).arrayBuffer());
  const historical = await f.api.read(
    read(
      { kind: "artifact", id: response.analysisId },
      { kind: "document" },
      { projection: "components" },
    ),
  );
  expect(historical.rows).toEqual(response.rows);
  expect(f.counts()).toEqual(before);
  expect(createHash("sha256").update(saved).digest("hex")).toBe(response.analysisId);
  const encoded = JSON.parse(saved.toString("utf8"));
  expect(encoded.format).toBe("ducts-analysis-v5");
  const stored = encoded.outputs.next.design.componentFlows[0].hydraulics;
  expect(stored.lawEvidence).toBeUndefined();
  expect(stored.lawIndices.length).toBeGreaterThan(0);
  expect(stored.lawIndices.every((i: number) => encoded.hydraulicLaws[i])).toBe(true);
  const save = (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const id = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(f.root, `${id}.json`), bytes);
    return id;
  };
  for (const index of [-1, 0.5, encoded.hydraulicLaws.length, Number.MAX_SAFE_INTEGER]) {
    const bad = structuredClone(encoded);
    bad.outputs.next.design.componentFlows[0].hydraulics.lawIndices[0] = index;
    await expect(
      f.api.read(
        read(
          { kind: "artifact", id: save(bad) },
          { kind: "document" },
          { projection: "components" },
        ),
      ),
    ).rejects.toThrow("hydraulic law reference is invalid");
  }
  const missing = structuredClone(encoded);
  delete missing.hydraulicLaws;
  await expect(f.api.read(read({ kind: "artifact", id: save(missing) }))).rejects.toThrow(
    "hydraulic law pool is missing",
  );
  expect(f.counts()).toEqual(before);
});

function candidateWork() {
  return ductsDocumentSchema.parse({
    terminalDrops: {
      "2": {
        staged: { value: { inWg: 0.12, source: "Approved purpose point" } },
        proposal: { value: { inWg: 9, source: "Not accepted" } },
      },
    },
    componentDrops: { "3": { staged: { value: { inWg: 0.02, source: "Stated component" } } } },
    parameters: { terminalDrop: { staged: { value: "TerminalDrop" } } },
  });
}
const candidateRead = (id: string, selector: unknown = { kind: "document" }) =>
  read({ kind: "artifact", id }, selector, { projection: "apply-request" });
const hashJson = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function storeChanged(f: ReturnType<typeof fixture>, artifact: unknown) {
  const bytes = Buffer.from(JSON.stringify(artifact));
  const id = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(f.root, `${id}.json`), bytes);
  return id;
}
test("apply-request builds a canonical immutable candidate without reacquiring", async () => {
  const f = fixture();
  const doc = candidateWork();
  f.snapshot.store = {
    version: 1,
    rules: {},
    instances: {},
    terminals: {},
    terminalFlows: {},
    equipmentFlows: {},
    verdicts: {},
    roles: {},
    workRevision: 3,
    customerKeep: { exact: [1, "untouched"] },
  };
  let workReadCalls = 0;
  f.sources.readWork = async () => {
    workReadCalls++;
    return { doc, revision: 7 };
  };
  const initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  const original = Buffer.from(await (await f.api.artifact(initial.analysisId)).arrayBuffer());
  const artifact = JSON.parse(original.toString("utf8"));
  const input = JSON.parse(gunzipSync(Buffer.from(artifact.input.data, "base64")).toString("utf8"));
  const before = f.counts();
  expect(workReadCalls).toBe(2);
  const candidate = ductsAnalysisResponseSchema.parse(
    await f.api.read(candidateRead(initial.analysisId)),
  );
  const meta = candidate.applyRequest!;
  expect(meta.mode).toBe("historical-candidate-requires-approval-and-revalidation");
  expect(meta.counts).toEqual({
    fittings: 0,
    terminals: 1,
    components: 1,
    equipment: 0,
    unpricedRuleInstances: 0,
  });
  expect(candidate.rows).toEqual([]);
  expect(Buffer.byteLength(JSON.stringify(candidate))).toBeLessThanOrEqual(65536);
  const bytes = Buffer.from(await (await f.api.artifact(meta.artifact.id)).arrayBuffer());
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(meta.artifact.sha256);
  const plan = ductsApplyRequestArtifactSchema.parse(JSON.parse(bytes.toString("utf8")));
  const expected = ductsApplyInputSchema.parse(
    applyRequest(
      input.snapshot,
      price(input.snapshot, toGrids(input.tables), input.work),
      plan.createdAt,
      [],
    ),
  );
  expect(plan.payload).toEqual(expected);
  expect(plan.payloadSha256).toBe(hashJson(plan.payload));
  expect(plan.payloadByteSize).toBe(Buffer.byteLength(JSON.stringify(plan.payload)));
  expect(plan.source.work).toMatchObject({ revision: 7, jsonSha256: hashJson(input.work) });
  expect(plan.source.snapshotJsonSha256).toBe(hashJson(input.snapshot));
  expect(plan.source.tablesJsonSha256).toBe(hashJson(input.tables));
  expect(plan.payload.store.customerKeep).toEqual({ exact: [1, "untouched"] });
  expect(plan.payload.terminals).toEqual([{ id: 2, inWg: 0.12, source: "Approved purpose point" }]);
  expect(plan.source.target).toEqual(f.target);
  expect(plan.source.acquisitions.map((r) => r.sha256)).toEqual(
    artifact.acquisition.map((r: { sha256: string }) => r.sha256),
  );
  expect(Buffer.from(await (await f.api.artifact(initial.analysisId)).arrayBuffer())).toEqual(
    original,
  );
  expect(f.counts()).toEqual(before);
  expect(workReadCalls).toBe(2);
  await expect(f.api.read(read({ kind: "artifact", id: meta.artifact.id }))).rejects.toThrow(
    "Unsupported analysis format",
  );
  const group = await f.api.read(candidateRead(initial.analysisId, { kind: "group", id: "g" }));
  expect(group.applyRequest!.counts.components).toBe(0);
  await expect(
    f.api.read(candidateRead(initial.analysisId, { kind: "group", id: "absent" })),
  ).rejects.toThrow("group is unavailable");
});

test("apply-request refuses changed producer outputs, custody, Work and unsupported formats without acquisitions", async () => {
  const f = fixture();
  f.sources.readWork = async () => ({ doc: candidateWork(), revision: 1 });
  const fresh = await f.api.read(read({ kind: "fresh", target: f.target }));
  const original = JSON.parse(await (await f.api.artifact(fresh.analysisId)).text());
  const before = f.counts();
  const mutations = [
    (a: typeof original) => {
      a.outputs.next.paths["2"].rows[0].dp = 123;
    },
    (a: typeof original) => {
      a.producer.version = "other";
    },
    (a: typeof original) => {
      a.producer.installedRoot = "foreign";
    },
    (a: typeof original) => {
      delete a.producer.version;
    },
    (a: typeof original) => {
      a.freshness.state = "changed";
    },
    (a: typeof original) => {
      a.work.revision = null;
    },
    (a: typeof original) => {
      a.work.key = { binding: "host", route: "ducts" };
    },
    (a: typeof original) => {
      a.acquisition[0].sha256 = "0".repeat(64);
    },
    (a: typeof original) => {
      a.acquisition[0].byteSize++;
    },
    (a: typeof original) => {
      a.acquisition.reverse();
    },
    (a: typeof original) => {
      a.format = "ducts-analysis-v4";
    },
  ];
  for (const change of mutations) {
    const altered = structuredClone(original);
    change(altered);
    await expect(f.api.read(candidateRead(storeChanged(f, altered)))).rejects.toThrow();
  }
  // Host lifetime differs, exact producer applicability and reproduced outputs still agree.
  const restart = structuredClone(original);
  restart.producer.processId++;
  expect((await f.api.read(candidateRead(storeChanged(f, restart)))).applyRequest).not.toBeNull();
  expect(f.counts()).toEqual(before);
  for (const extra of [
    { source: { kind: "fresh", target: f.target } },
    { selector: { kind: "terminal", id: 2 } },
    { cursor: { offset: 0, basis: "a".repeat(64) } },
  ])
    expect(
      ductsAnalysisRequestSchema.safeParse({
        source: { kind: "artifact", id: fresh.analysisId },
        selector: { kind: "document" },
        projection: "apply-request",
        ...extra,
      }).success,
    ).toBe(false);
});

test("apply-request cannot turn proposal-only or physical fan required head into native writes", async () => {
  const f = fixture();
  let doc = ductsDocumentSchema.parse({
    terminalDrops: { "2": { proposal: { value: { inWg: 2, source: "Unaccepted" } } } },
  });
  f.sources.readWork = async () => ({ doc, revision: 1 });
  let initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  await expect(f.api.read(candidateRead(initial.analysisId))).rejects.toThrow(
    "No native write values",
  );
  doc = candidateWork();
  f.snapshot.storeError = "corrupt store";
  initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  await expect(f.api.read(candidateRead(initial.analysisId))).rejects.toThrow(
    "store is unreadable",
  );
  delete f.snapshot.storeError;
  for (const n of f.snapshot.nodes) n.uniqueId = `purpose-${n.id}`;
  f.snapshot.nodes[0]!.connectors[0]!.direction = "out";
  doc = ductsDocumentSchema.parse({
    ...candidateWork(),
    esp: { "1": { staged: { value: { inWg: 0.25 } } } },
    calculation: {
      fan: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 1, uniqueId: "purpose-1" },
            inlet: null,
            outlet: {
              index: 1,
              point: [0, 0, 0],
              shape: "round",
              diameterIn: 8,
              widthIn: null,
              heightIn: null,
              direction: "out",
              connectedTo: { id: 2, uniqueId: "purpose-2", connector: 1 },
            },
            designFlowCfm: 100,
            referenceTotalPressureInWg: 0,
            source: "Purpose physical fan",
          },
        },
      },
    },
  });
  initial = await f.api.read(read({ kind: "fresh", target: f.target }));
  await expect(f.api.read(candidateRead(initial.analysisId))).rejects.toThrow(
    "no admitted manufacturer scalar ESP mapping",
  );
});

test("apply-request never publishes a clipped candidate above the complete artifact budget", async () => {
  const f = fixture();
  const doc = ductsDocumentSchema.parse({
    terminalDrops: Object.fromEntries(
      Array.from({ length: 17000 }, (_, n) => [
        String(n + 20000),
        { staged: { value: { inWg: 0.01, source: "x".repeat(8000) } } },
      ]),
    ),
  });
  f.sources.readWork = async () => ({ doc, revision: 1 });
  const source = await f.api.read(read({ kind: "fresh", target: f.target }));
  const sourceBytes = Buffer.from(await (await f.api.artifact(source.analysisId)).arrayBuffer());
  const before = f.counts();
  await expect(f.api.read(candidateRead(source.analysisId))).rejects.toThrow(
    "Apply request exceeds byte budget",
  );
  expect(f.counts()).toEqual(before);
  expect(Buffer.from(await (await f.api.artifact(source.analysisId)).arrayBuffer())).toEqual(
    sourceBytes,
  );
}, 30000);

test("apply-request uses canonical staged fitting lookup and names unpriced instances", async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    Object.assign(
      f.snapshot,
      JSON.parse(
        readFileSync(
          new URL("../../web/src/ducts/fixtures/synthetic-snapshot.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const tables = {
      tables: missing
        ? {}
        : {
            "CD3-2": {
              Co: { title: "Purpose constant coefficient", xLabel: "D", x: [], grid: [0.24] },
            },
          },
      missing: [],
      unsupported: [],
    };
    f.sources.call = async (key) => Response.json(key === "ducts.snapshot" ? f.snapshot : tables);
    const doc = ductsDocumentSchema.parse({
      rules: { "elbow-1d-gt10": { staged: { value: { table: "CD3-2" } } } },
    });
    f.sources.readWork = async () => ({ doc, revision: 1 });
    const initial = await f.api.read(read({ kind: "fresh", target: f.target }));
    const candidate = await f.api.read(candidateRead(initial.analysisId));
    const plan = ductsApplyRequestArtifactSchema.parse(
      await (await f.api.artifact(candidate.applyRequest!.artifact.id)).json(),
    );
    const expected = ductsApplyInputSchema.parse(
      applyRequest(f.snapshot, price(f.snapshot, toGrids(tables), doc), plan.createdAt, []),
    );
    expect(plan.payload).toEqual(expected);
    expect(plan.payload.fittings).toHaveLength(missing ? 0 : 1);
    expect(plan.unpriced).toHaveLength(missing ? 1 : 0);
    if (!missing)
      expect(plan.payload.fittings[0]).toMatchObject({
        method: "pe-server",
        coefficient: 0.24,
        table: "CD3-2",
        ruleKey: "elbow-1d-gt10",
      });
  }
});

test("ports exposes exact open fan pins and derived exterior flow without historical reacquisition", async () => {
  const f = fixture();
  for (const n of f.snapshot.nodes) n.uniqueId = `purpose-${n.id}`;
  f.snapshot.nodes[0]!.connectors[0]!.direction = "out";
  f.snapshot.nodes[1]!.connectors[0]!.direction = "in";
  f.snapshot.nodes[0]!.connectors.push({
    index: 3,
    kind: "end",
    size: "17.5x21",
    point: [0, 0, -1],
    shape: "rectangular",
    diameterIn: null,
    widthIn: 17.5,
    heightIn: 21,
    direction: "in",
    connectedTo: null,
  });
  const open: DuctPortPin = {
    index: 3,
    point: [0, 0, -1],
    shape: "rectangular",
    diameterIn: null,
    widthIn: 17.5,
    heightIn: 21,
    direction: "in",
    connectedTo: null,
  };
  const pin = (id: number, direction: string): DuctPortPin => ({
    index: 1,
    point: [0, 0, 0],
    shape: "round",
    diameterIn: 8,
    widthIn: null,
    heightIn: null,
    direction,
    connectedTo: { id: id === 1 ? 2 : 1, uniqueId: `purpose-${id === 1 ? 2 : 1}`, connector: 1 },
  });
  const doc = ductsDocumentSchema.parse({
    calculation: {
      fan: {
        staged: {
          value: {
            kind: "fan",
            element: { id: 1, uniqueId: "purpose-1" },
            inlet: open,
            outlet: pin(1, "out"),
            designFlowCfm: null,
            referenceTotalPressureInWg: 999,
            source: "Purpose exact physical fan faces",
          },
        },
      },
      terminal: {
        staged: {
          value: {
            kind: "terminal",
            element: { id: 2, uniqueId: "purpose-2" },
            port: pin(2, "in"),
            role: "demand",
            flowCfm: 100,
            boundaryTotalPressureInWg: 0,
            loss: { flowCfm: 100, totalLossInWg: 0.08, source: "Purpose TOTAL" },
            source: "Purpose demand",
          },
        },
      },
    },
  });
  f.sources.readWork = async () => ({ doc, revision: 18 });
  const fresh = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "ports" }),
  );
  const row = fresh.rows.find((r) => r.id === 1 && r.port?.index === 3)!;
  expect(row.port).toMatchObject({
    pin: open,
    connection: null,
    reciprocal: false,
    reason: null,
    externalExchange: { ownerOutwardCfm: -100, inflowCfm: 100, derivation: "fan-continuity" },
  });
  const before = f.counts();
  const historical = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "artifact", id: fresh.analysisId },
        { kind: "document" },
        { projection: "ports" },
      ),
    ),
  );
  expect(historical.rows).toEqual(fresh.rows);
  expect(f.counts()).toEqual(before);
});

test("the survey joins a sub-tolerance gap, takes the terminal flow from the load preview and emits findings", async () => {
  const f = fixture();
  const [fan, grille] = f.snapshot.nodes as [
    DuctSnapshot["nodes"][number],
    DuctSnapshot["nodes"][number],
  ];
  // A 0.4 in gap: neither port is attached, the grille sits 0.4 in down the x axis.
  fan.connectors[0]!.connectedTo = null;
  grille.connectors[0]!.connectedTo = null;
  grille.connectors[0]!.point = [0.4 / 12, 0, 0];
  fan.facts.push({ key: "mark", text: "FC-4", unit: "", provenance: "revit-reported" });
  const doc = ductsDocumentSchema.parse({
    loads: {
      preview: {
        staged: {
          value: {
            systems: [{ name: "System 1 Office FC-4", tag: "FC-4", cfm: 250, rooms: [] }],
          },
        },
      },
    },
  });
  f.sources.readWork = async () => ({ doc, revision: 3 });
  const summary = ductsAnalysisResponseSchema.parse(
    await f.api.read(read({ kind: "fresh", target: f.target })),
  );
  expect(summary.findings).toEqual([
    expect.objectContaining({
      kind: "joined-by-proximity",
      elementIds: [1, 2],
      clearer: "person",
      grade: "stretched",
      assumed: expect.stringContaining("0.40 in apart; joined"),
    }),
    expect.objectContaining({
      kind: "no-fan-static",
      elementIds: [1],
      clearer: "route",
      note: expect.stringContaining("computed by the route when the path prices"),
    }),
  ]);
  expect(summary.findingCounts).toEqual({
    byKind: { "joined-by-proximity": 1, "no-fan-static": 1 },
    byClearer: { route: 1, pea: 0, person: 1 },
  });
  expect(summary.completeness.reasons.map((r) => r.code)).not.toContain("unreached-terminals");
  expect(summary.completeness.reasons.map((r) => r.code)).not.toContain("unknown-terminal-flow");
  const terminals = ductsAnalysisResponseSchema.parse(
    await f.api.read(
      read(
        { kind: "artifact", id: summary.analysisId },
        { kind: "document" },
        {
          projection: "terminals",
        },
      ),
    ),
  );
  // Revit states 100 cfm on the grille; the staged load preview's 250 wins for the staged solve.
  expect(terminals.rows).toEqual([
    expect.objectContaining({
      id: 2,
      flowCfm: 250,
      flowSource: "load-preview:FC-4",
      requiredEspStagedInWg: 0.08,
    }),
  ]);
  expect(terminals.findings).toEqual([]);
  expect(terminals.findingCounts).toEqual(summary.findingCounts);

  // Without a Mark the unit cannot match any preview system, and the survey says so to the person.
  fan.facts = fan.facts.filter((fact) => fact.key !== "mark");
  const markless = ductsAnalysisResponseSchema.parse(
    await f.api.read(read({ kind: "fresh", target: f.target })),
  );
  expect(markless.findings.slice(0, 2).map((finding) => finding.clearer)).toEqual([
    "person",
    "person",
  ]);
  expect(markless.findings).toContainEqual(
    expect.objectContaining({ kind: "no-mark", elementIds: [1], clearer: "person" }),
  );
  expect(markless.findingCounts.byClearer).toEqual({ route: 1, pea: 0, person: 3 });
});
