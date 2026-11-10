import { describe, expect, test } from "vite-plus/test";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { buildCapabilities, createRouteRegistrations } from "@pe/mcps";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RouteWorkspace } from "../../../../../ts/packages/runtime/src/index.ts";
import { fileRouteDocumentStore } from "../../../../../ts/apps/host/src/route-document-store.ts";
import { sizing } from "./host.ts";
import { fromRevit, hydraulics, size, type Pipe } from "./size.ts";
import type { MepSystemMembers } from "@pe/host-contracts/generated";
import { module } from "./module.ts";
import { key, work } from "./schema.ts";
import { readFile } from "node:fs/promises";
import manifest from "../../pod.json" with { type: "json" };
import { admitPodArtifact } from "../../../../../ts/apps/host/src/pod-artifact.ts";

// Copper-ish nominal/inner pairs, mm. The real catalog is the model's pipe segment (see gaps).
const catalogs = { s: [{ nominal: 15, inner: 13.6 }, { nominal: 20, inner: 19.9 }, { nominal: 25, inner: 26 }, { nominal: 32, inner: 32.1 }] };
const limits = { maxVelocity: 1.5, maxFriction: 400 };
const pipe = (uniqueId: string, flow: number | null, diameter: number, upstream: string | null = null): Pipe =>
  ({ uniqueId, label: uniqueId, flow, diameter, length: 10, upstream, segment: "s" });

describe("sizing", () => {
  test("candidate is the smallest catalog size within both limits", () => {
    const [row] = size([pipe("a", 0.3, 25)], catalogs, limits, {}).rows;
    expect(row?.candidate).toBe(25);
    expect(hydraulics(0.3, 19.9).friction).toBeGreaterThan(400);
    expect(hydraulics(0.3, 26).velocity).toBeLessThan(1.5);
  });
  test("statuses and the unresolved list come first; the pump head waits for them", () => {
    const out = size([pipe("ok", 0.3, 25), pipe("small", 0.3, 15), pipe("big", 0.3, 32), pipe("dry", null, 20), pipe("huge", 50, 32)], catalogs, limits, {});
    expect(out.rows.map((r) => r.status)).toEqual(["ok", "undersized", "oversized", "no-flow", "undersized"]);
    expect(out.unresolved.map((u) => `${u.uniqueId}:${u.kind}`)).toEqual(["small:exceeds-limit", "dry:no-flow", "huge:exceeds-limit"]);
    expect(out.pumpHead).toEqual({ pa: null, greyed: true });
  });
  test("pump head is the longest friction path on the chosen sizes", () => {
    const pipes = [pipe("main", 0.6, 32), pipe("left", 0.3, 25, "main"), pipe("right", 0.1, 25, "main")];
    const out = size(pipes, catalogs, limits, { right: 15 });
    const loss = (flow: number, inner: number) => hydraulics(flow, inner).friction * 10;
    expect(out.pumpHead.greyed).toBe(false);
    expect(out.pumpHead.pa).toBeCloseTo(loss(0.6, 32.1) + Math.max(loss(0.3, 26), loss(0.1, 13.6)));
    expect(out.rows[2]?.chosen).toBe(15);
  });
  test("the catalog offers the generic MEP reads this Pod sizes from", () => {
    expect(reads).toEqual(expect.arrayContaining(["mep.system.members", "mep.segment.sizes"]));
  });
  test("fromRevit roots pipes at the base connector across fittings and converts units", () => {
    const v = (value: number | null) => ({ state: "Value" as const, value });
    const port = (connectorId: number, ...peers: string[]) => ({ connectorId, direction: { state: "Value" as const, value: "Bidirectional" },
      peers: peers.map((uniqueId) => ({ uniqueId, elementId: 0, connectorId: 0 })) });
    const ref = { uniqueId: "seg", elementId: 9, name: "Steel" };
    const member = (uniqueId: string, kind: string, ...peers: string[]): MepSystemMembers.Res.MepMember => ({
      uniqueId, elementId: 1, name: uniqueId, kind, flowCubicFeetPerSecond: v(0.01), nominalDiameterFt: v(0.0833), innerDiameterFt: v(0.08),
      widthFt: v(null), heightFt: v(null), lengthFt: v(10), segment: { state: "Value", value: ref }, type: { state: "Value", value: ref },
      connectors: peers.map((peer, i) => port(i, peer)) });
    const pump = { uniqueId: "pump", elementId: 2, name: "Pump" };
    const read = { systemUniqueId: "sys", systems: [{ uniqueId: "sys", elementId: 3, name: "HW", domain: "piping", classification: "Supply",
      systemType: { state: "Value" as const, value: ref }, flowCubicFeetPerSecond: v(0.02),
      source: { state: "Value" as const, value: { equipment: pump, baseConnectorId: 7, outConnectorIds: [], connectors: [port(7, "a")] } } }],
      elements: [member("a", "curve", "pump", "elbow"), member("elbow", "fitting", "a", "b"), member("b", "curve", "elbow", "tee"),
        member("tee", "fitting", "b", "c", "d"), member("c", "curve", "tee"), member("d", "curve", "tee"), member("loose", "curve")] };
    const out = fromRevit(read, { segments: [{ uniqueId: "seg", elementId: 9, name: "Steel", domain: "piping", kind: "pipe",
      sizes: [{ nominalDiameterFt: 0.0833, innerDiameterFt: 0.08, outerDiameterFt: 0.09 }] }] });
    expect(Object.fromEntries(out.pipes.map((p) => [p.uniqueId, p.upstream]))).toEqual({ a: null, b: "a", c: "b", d: "b", loose: null });
    expect(out.rooted).toBe(false);
    expect(out.pipes[0]).toMatchObject({ diameter: 25.4, length: 3.048, segment: "seg" });
    expect(out.pipes[0]?.flow).toBeCloseTo(0.283, 3);
    expect(out.catalogs).toEqual({ seg: [{ nominal: 25.4, inner: 24.4 }] });
  });
  test("route-wide inputs default to 1.5 m/s and 400 Pa/m", () => {
    // 400 Pa/m is the firm layer's seed; Work leaves maxFriction absent until an author sets it.
    expect(work.parse({})).toMatchObject({ maxVelocity: 1.5, chosen: {} });
    expect(work.parse({}).maxFriction).toBeUndefined();
    expect(module.data.key).toBe(key);
  });
  test("the published artifact is current and admits on the host", async () => {
    const [row] = manifest.routes;
    const bytes = JSON.parse(await readFile(new URL("./route.artifact", import.meta.url), "utf8"));
    const host = await admitPodArtifact(bytes, row?.fingerprint ?? "", true);
    expect(host.data).toEqual(module.data);
    expect(Object.keys(host.reads ?? {})).toContain("sizing");
  });
});

// Each red test names a capability the spec needs and a Pod cannot reach today (gaps.json); a closed one is a plain test.
// test.fails keeps the suite green while the gap is open and fails the day the kernel closes it:
// then make it a plain test and use the capability.
const reads = hostOpCatalog.filter((op) => op.intent === "Read").map((op) => op.key);
const hostDoors = async () => Object.keys(await import("@pe/host/read-graph"));
describe("kernel gaps", () => {
  test("kernel door: pod-native-read-door (2)", async () => {
    expect(await hostDoors()).toContain("nativeRead");
  });
  // Closed by slice 7: the read binds the target document's Work (ctx.work with the document ref; the
  // evaluator resolves its key, host tests/slots-sheet.test.ts), takes the firm layer (ctx.firm) and both
  // generic MEP reads (ctx.native). A Pod host imports no read-graph value. Run against a recording ReadContext.
  test("kernel doors: pod-document-work (4) and firm-file-layer (3)", async () => {
    const calls: string[] = [];
    const target = { kind: "document" as const, ref: { session: "s", openId: "o" } };
    const ctx = {
      work: async (owner: string, scope: unknown) => {
        calls.push(`work:${owner}:${JSON.stringify(scope)}`);
        return { doc: work.parse({ maxVelocity: 2 }), revision: 1 };
      },
      firm: async (owner: string, _schema: unknown, seed: { maxFriction: number }) => {
        calls.push(`firm:${owner}`);
        return { firm: { maxFriction: 250 }, path: "Firm/hydronic.json", present: true, seed };
      },
      native: async (key: string, args: { request: { systemUniqueId?: string } }) => {
        calls.push(`native:${key}:${args.request.systemUniqueId ?? ""}`);
        return { body: key === "mep.segment.sizes" ? { segments: [] }
          : { systemUniqueId: args.request.systemUniqueId ?? null, elements: [],
              systems: [{ uniqueId: "sys", domain: "piping", source: { state: "Absent" } }] } };
      },
      compute: (_schema: unknown, inputs: unknown, pure: (i: unknown) => unknown) => pure(inputs),
    };
    const out = await sizing.run(ctx as never, { system: "", target });
    expect(calls).toEqual([
      `work:${key}:${JSON.stringify(target.ref)}`,
      "firm:hydronic",
      "native:mep.system.members:",
      "native:mep.system.members:sys",
      "native:mep.segment.sizes:",
    ]);
    // Work's own limit wins; the firm file supplies the one Work leaves absent.
    expect(out.result.value?.limits).toEqual({ maxVelocity: 2, maxFriction: 250 });
  });
  test("kernel slot: sheet-slot (3)", () => {
    expect(module.data).toHaveProperty("sheet");
  });
  test("kernel slot: parameter-binding (4)", () => {
    // The slot's data projection (sheetSlotDataSchema) keys bindings under `bindings`.
    expect(module.data).toMatchObject({ sheet: { bindings: { chosen: { kind: "parameter", parameter: "Diameter" } } } });
  });
  test.fails("kernel gap: subjectref-codec (4)", async () => {
    // chosen is keyed by a raw UniqueId string; no SubjectRef codec exists to key it by.
    expect(Object.keys(await import("@pe/agent-contracts/route-kernel-codecs"))).toContainEqual(expect.stringMatching(/subjectref/i));
  });
  // V3, closed by slice 7: an admitted Pod's Work is a Pea door, from the workspace's own admission.
  test("kernel door: pea-stages-pod-work (4)", async () => {
    const root = await mkdtemp(join(tmpdir(), "hydronic-"));
    const workspace = new RouteWorkspace({ registrations: [], store: fileRouteDocumentStore(root) });
    const [row] = manifest.routes;
    const bytes = JSON.parse(await readFile(new URL("./route.artifact", import.meta.url), "utf8"));
    workspace.registerAdmitted(await admitPodArtifact(bytes, row?.fingerprint ?? ""));
    const rows = buildCapabilities({ ops: [], routes: createRouteRegistrations().map((r) => r.spec), packages: [], skills: [],
      admittedRoutes: () => workspace.admittedRoutes() });
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining([`route:${key}`, `route:${key}.edit`]));
  });
  test.fails("kernel gap: picture-slot (5)", () => {
    expect(module.data).toHaveProperty("picture");
  });
  test("kernel slot: goal-slot (6)", () => {
    // The core is the Goal; the kernel's goal pane draws its unresolved list first.
    expect(module.data).toMatchObject({ goal: "value", panes: { goal: { draws: ["value"] } } });
  });
  test.fails("kernel gap: findings (7)", () => {
    expect([...linkedCatalog().entries.keys()]).toContain("findings.write");
  });
  test("kernel door: pod-parameter-write (8)", () => {
    // The parameter binding earns the one sheet pair: the Pod adds no native op (ADR 0030 rule 12).
    expect(Object.values(module.data.verbs).map((v) => v.kind)).toContain("command");
    expect(module.data.verbs.sheet).toMatchObject({ kind: "command", entry: "sheet.apply" });
  });
});
