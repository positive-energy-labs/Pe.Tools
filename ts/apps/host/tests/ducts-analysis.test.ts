import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { createPeRoutes } from "../src/pe-routes.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
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
import { createDuctsAnalysis, type DuctsAnalysisSources } from "../src/ducts-analysis.ts";

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
    systems: [
      {
        id: 3,
        name: "SA",
        classification: "SupplyAir",
        baseEquipmentId: 1,
        criticalPath: [],
        sections: [],
      },
    ],
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
        edit: { value: { kind: "balanced-design", source: "Purpose balanced design" } },
      },
      fan: {
        edit: {
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
        edit: {
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
      scenario: { edit: { value: { kind: "balanced-design", source: "Synthetic design" } } },
      a: {
        edit: {
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
        edit: {
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
        edit: {
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
    calculation: { ...doc.calculation, flow: { suggestion: { value: design } } },
  });
  f.sources.readWork = async () => ({ doc: staged, revision: 2 });
  const proposal = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "components" }),
  );
  expect(proposal.rows[0]!.component?.status).toBe("underdetermined");
  staged = ductsDocumentSchema.parse({
    ...doc,
    calculation: { ...doc.calculation, flow: { edit: { value: design } } },
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

test("a reading whose findings alone pass the budget keeps a row and every count", async () => {
  const f = fixture();
  for (let i = 0; i < 1500; i++)
    f.snapshot.issues.push({
      id: `stub:g:${1000 + i}`,
      kind: "stub",
      elementId: 1,
      point: [0, 0, 0],
      groupId: "g",
      note: "Y".repeat(60),
    } as DuctSnapshot["issues"][number]);
  const page = await f.api.read(
    read({ kind: "fresh", target: f.target }, { kind: "document" }, { projection: "summary" }),
  );
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(65536);
  expect(page.rows.length).toBeGreaterThan(0);
  expect(page.findings.length).toBeLessThan(1500);
  expect(page.findingCounts.byKind.stub).toBe(1500);
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
      scenario: { edit: { value: { kind: "balanced-design", source: "Purpose design" } } },
      fan: {
        edit: {
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
        edit: {
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
        edit: {
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
        edit: { value: { inWg: 0.12, source: "Approved purpose point" } },
        suggestion: { value: { inWg: 9, source: "Not accepted" } },
      },
    },
    componentDrops: { "3": { edit: { value: { inWg: 0.02, source: "Stated component" } } } },
    parameters: { terminalDrop: { edit: { value: "TerminalDrop" } } },
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
    terminalDrops: { "2": { suggestion: { value: { inWg: 2, source: "Unaccepted" } } } },
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
    esp: { "1": { edit: { value: { inWg: 0.25 } } } },
    calculation: {
      fan: {
        edit: {
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
        edit: {
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
  expect(summary.findingCounts).toMatchObject({
    byKind: { "joined-by-proximity": 1, "no-fan-static": 1 },
    byClearer: { route: 1, pea: 0, person: 1 },
  });
  // Graded keys carry the grade; the ungraded finding keeps its bare kind.
  expect(Object.values(summary.findingCounts.byKindAndGrade).reduce((a, b) => a + b, 0)).toBe(2);
  const graded = Object.keys(summary.findingCounts.byKindAndGrade).filter((k) =>
    k.startsWith("joined-by-proximity:"),
  );
  expect(graded).toHaveLength(1);
  expect(["near-miss", "stretched", "anomalous"]).toContain(graded[0]!.split(":")[1]);
  expect(summary.findingCounts.byKindAndGrade["no-fan-static"]).toBe(1);
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
