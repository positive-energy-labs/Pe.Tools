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
  ductsRouteState,
  type DuctPortPin,
} from "@pe/agent-contracts";
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
    systems: [],
    slots: {
      fanStatic: "FanStatic",
      fanFlow: "FanFlow",
      componentDrop: "Pressure Drop",
      fittingCoefficient: "Pe_C",
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
    producer: { lane: "deterministic-purpose-fixture" },
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
  expect(JSON.parse(artifact.input.json).snapshot).toEqual(f.snapshot);
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
  expect(artifact.format).toBe("ducts-analysis-v2");
  expect(JSON.parse(artifact.input.json).work).toEqual(doc);
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
  const routes = createPeRoutes({
    registrations: [],
    heads: { observe: () => () => {} },
    store: { getState: async () => null, setState: async () => {} },
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
      if (url.pathname === "/pe/ducts/analysis") return routes.fetch(request);
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
