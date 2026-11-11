import { describe, expect, test } from "vite-plus/test";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { createRouteRegistrations } from "@pe/mcps";
import { fromRevit, hydraulics, size, type Pipe } from "./size.ts";
import type { MepSystemMembers } from "@pe/host-contracts/generated";
import { module } from "./module.ts";
import { key, pipeKey, work } from "./schema.ts";
import { decode } from "@pe/agent-contracts/subject-ref";
import { readFile } from "node:fs/promises";
import manifest from "../../pod.json" with { type: "json" };
import { admitPodArtifact } from "../../../../../ts/apps/host/src/pod-artifact.ts";
import { buildRouteArtifact } from "../../../../../ts/apps/web/route-module-hash.ts";
import { fileURLToPath } from "node:url";

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
    const out = size(pipes, catalogs, limits, { [pipeKey("right")]: 15 });
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
  test("chosen diameters are keyed by the pipe's UniqueId as a SubjectRef code", () => {
    expect(decode(pipeKey("a1-b2"))).toMatchObject({ ok: true, value: { keyKind: "UniqueId", key: "a1-b2" } });
    expect(work.parse({ chosen: { [pipeKey("a1-b2")]: 25 } }).chosen).toEqual({ "UniqueId:a1-b2": 25 });
    expect(() => work.parse({ chosen: { "a1-b2": 25 } })).toThrow();
  });
  test("route-wide inputs default to 1.5 m/s and 400 Pa/m", () => {
    expect(work.parse({})).toMatchObject({ maxVelocity: 1.5, maxFriction: 400, chosen: {} });
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

// Each red test names a capability the spec needs and a Pod cannot reach today (gaps.json).
// test.fails keeps the suite green while the gap is open and fails the day the kernel closes it:
// then make it a plain test and use the capability.
const reads = hostOpCatalog.filter((op) => op.intent === "Read").map((op) => op.key);
// A Pod reaches a door only if its artifact bundles: the builder refuses an unpinned shared runtime.
const bundles = (source: string) => buildRouteArtifact({ entry: fileURLToPath(new URL("./probe.ts", import.meta.url)),
  source, data: module.data, contracts: [{ id: "probe", bytes: new Uint8Array([0]) }] });
describe("kernel gaps", () => {
  test.fails("kernel gap: pod-native-read-door (2)", async () => {
    // nativeRead lives in host src/reads/inputs.ts; @pe/host/read-graph does not export it.
    await bundles(`import { nativeRead } from "@pe/host/read-graph"; export const read = nativeRead("mep.system.members");`);
  }, 60_000);
  test.fails("kernel gap: pod-document-work (4)", async () => {
    // workScope (document ref to Work key) is exported, but @pe/host/read-graph imports the
    // @pe/agent-contracts barrel, which pulls effect; the Pod host artifact refuses it.
    await bundles(`import { workScope } from "@pe/host/read-graph"; export const scope = workScope;`);
  }, 60_000);
  test.fails("kernel gap: firm-file-layer (3)", async () => {
    // The firm file is a resolution layer (ADR 0035 d3), on the share only since slice 2b; its leaf
    // is host-private builtin-read-handles, so max friction defaults to 400.
    await bundles(`import { firm } from "@pe/host/read-graph"; export const layer = firm;`);
  }, 60_000);
  test.fails("kernel gap: sheet-slot (3)", () => {
    // A Pod pane returns text; the kernel draws no StateCell for maxVelocity, maxFriction or chosen.
    expect(module.data).toHaveProperty("sheet");
  });
  test.fails("kernel gap: parameter-binding (4)", () => {
    expect(module.data).toMatchObject({ sheet: { chosen: { binding: { kind: "parameter", parameter: "Diameter" } } } });
  });
  test.fails("kernel gap: pea-stages-pod-work (4)", () => {
    // Pea's Work tools register builtin tools only (mcps/src/pea/routes.ts); an admitted Pod is absent.
    expect(createRouteRegistrations().map((r) => r.spec.route)).toContain(key);
  });
  test.fails("kernel gap: picture-slot (5)", () => {
    expect(module.data).toHaveProperty("picture");
  });
  test.fails("kernel gap: goal-slot (6)", () => {
    // The core computes the unresolved list; no slot draws it first or greys the pump head.
    expect(module.data).toHaveProperty("goal");
  });
  test.fails("kernel gap: findings (7)", () => {
    expect([...linkedCatalog().entries.keys()]).toContain("findings.write");
  });
  test.fails("kernel gap: pod-parameter-write (8)", () => {
    // No catalog ModelWrite sets parameter values; a Pod may add no native op (ADR 0030 rule 12).
    expect(Object.values(module.data.verbs).map((v) => v.kind)).toContain("command");
  });
});
