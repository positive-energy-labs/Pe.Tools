import { describe, expect, test } from "vite-plus/test";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { createRouteRegistrations } from "@pe/mcps";
import { hydraulics, size, type Pipe } from "./size.ts";
import { module } from "./module.ts";
import { key, work } from "./schema.ts";
import { readFile } from "node:fs/promises";
import manifest from "../../pod.json" with { type: "json" };
import { admitPodArtifact } from "../../../../../ts/apps/host/src/pod-artifact.ts";

// Copper-ish nominal/inner pairs, mm. The real catalog is the model's pipe segment (see gaps).
const catalog = [{ nominal: 15, inner: 13.6 }, { nominal: 20, inner: 19.9 }, { nominal: 25, inner: 26 }, { nominal: 32, inner: 32.1 }];
const limits = { maxVelocity: 1.5, maxFriction: 400 };
const pipe = (uniqueId: string, flow: number | null, diameter: number, upstream: string | null = null): Pipe =>
  ({ uniqueId, label: uniqueId, flow, diameter, length: 10, upstream });

describe("sizing", () => {
  test("candidate is the smallest catalog size within both limits", () => {
    const [row] = size([pipe("a", 0.3, 25)], catalog, limits, {}).rows;
    expect(row?.candidate).toBe(25);
    expect(hydraulics(0.3, 19.9).friction).toBeGreaterThan(400);
    expect(hydraulics(0.3, 26).velocity).toBeLessThan(1.5);
  });
  test("statuses and the unresolved list come first; the pump head waits for them", () => {
    const out = size([pipe("ok", 0.3, 25), pipe("small", 0.3, 15), pipe("big", 0.3, 32), pipe("dry", null, 20), pipe("huge", 50, 32)], catalog, limits, {});
    expect(out.rows.map((r) => r.status)).toEqual(["ok", "undersized", "oversized", "no-flow", "undersized"]);
    expect(out.unresolved.map((u) => `${u.uniqueId}:${u.kind}`)).toEqual(["small:exceeds-limit", "dry:no-flow", "huge:exceeds-limit"]);
    expect(out.pumpHead).toEqual({ pa: null, greyed: true });
  });
  test("pump head is the longest friction path on the chosen sizes", () => {
    const pipes = [pipe("main", 0.6, 32), pipe("left", 0.3, 25, "main"), pipe("right", 0.1, 25, "main")];
    const out = size(pipes, catalog, limits, { right: 15 });
    const loss = (flow: number, inner: number) => hydraulics(flow, inner).friction * 10;
    expect(out.pumpHead.greyed).toBe(false);
    expect(out.pumpHead.pa).toBeCloseTo(loss(0.6, 32.1) + Math.max(loss(0.3, 26), loss(0.1, 13.6)));
    expect(out.rows[2]?.chosen).toBe(15);
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
const hostDoors = async () => Object.keys(await import("@pe/host/read-graph"));
describe("kernel gaps", () => {
  test.fails("kernel gap: piping-system-read (1)", () => {
    // Looked in the host catalog: no Read lists a document's piping systems, or a system's pipes
    // with flow, diameter, length and upstream; revit.detail.elements needs ids it cannot find.
    expect(reads).toContainEqual(expect.stringMatching(/pip/));
  });
  test.fails("kernel gap: pipe-size-catalog-read (2)", () => {
    expect(reads).toContainEqual(expect.stringMatching(/segment|pipe.?size/i));
  });
  test.fails("kernel gap: pod-native-read-door (2)", async () => {
    // nativeRead lives in host src/reads/inputs.ts; @pe/host/read-graph does not export it.
    expect(await hostDoors()).toContain("nativeRead");
  });
  test.fails("kernel gap: pod-document-work (4)", async () => {
    // workBinding resolves a document's Work key; private to the host, so the Pod reads host-wide Work.
    expect(await hostDoors()).toContain("workBinding");
  });
  test.fails("kernel gap: firm-file-layer (3)", async () => {
    // The firm file is a resolution layer (ADR 0035 d3); its leaf is host-private builtin-read-handles.
    expect(await hostDoors()).toContain("firm");
  });
  test.fails("kernel gap: sheet-slot (3)", () => {
    // A Pod pane returns text; the kernel draws no StateCell for maxVelocity, maxFriction or chosen.
    expect(module.data).toHaveProperty("sheet");
  });
  test.fails("kernel gap: parameter-binding (4)", () => {
    expect(module.data).toMatchObject({ sheet: { chosen: { binding: { kind: "parameter", parameter: "Diameter" } } } });
  });
  test.fails("kernel gap: subjectref-codec (4)", async () => {
    // chosen is keyed by a raw UniqueId string; no SubjectRef codec exists to key it by.
    expect(Object.keys(await import("@pe/agent-contracts/route-kernel-codecs"))).toContainEqual(expect.stringMatching(/subjectref/i));
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
