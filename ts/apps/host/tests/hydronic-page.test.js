import { describe, expect, test } from 'vite-plus/test';
import { fromRevit, hydraulics, size } from '../../../../examples/pods/hydronic/pages/sizing/size.mjs';
// Copper-ish nominal/inner pairs, mm. The real catalog is the model's pipe segment (see gaps).
const catalogs = { s: [{ nominal: 15, inner: 13.6 }, { nominal: 20, inner: 19.9 }, { nominal: 25, inner: 26 }, { nominal: 32, inner: 32.1 }] };
const limits = { maxVelocity: 1.5, maxFriction: 400 };
const pipe = (uniqueId, flow, diameter, upstream = null) => ({ uniqueId, label: uniqueId, flow, diameter, length: 10, upstream, segment: "s" });
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
        const loss = (flow, inner) => hydraulics(flow, inner).friction * 10;
        expect(out.pumpHead.greyed).toBe(false);
        expect(out.pumpHead.pa).toBeCloseTo(loss(0.6, 32.1) + Math.max(loss(0.3, 26), loss(0.1, 13.6)));
        expect(out.rows[2]?.chosen).toBe(15);
    });
    test("fromRevit roots pipes at the base connector across fittings and converts units", () => {
        const v = (value) => ({ state: "Value", value });
        const port = (connectorId, ...peers) => ({ connectorId, direction: { state: "Value", value: "Bidirectional" },
            peers: peers.map((uniqueId) => ({ uniqueId, elementId: 0, connectorId: 0 })) });
        const ref = { uniqueId: "seg", elementId: 9, name: "Steel" };
        const member = (uniqueId, kind, ...peers) => ({
            uniqueId, elementId: 1, name: uniqueId, kind, flowCubicFeetPerSecond: v(0.01), nominalDiameterFt: v(0.0833), innerDiameterFt: v(0.08),
            widthFt: v(null), heightFt: v(null), lengthFt: v(10), segment: { state: "Value", value: ref }, type: { state: "Value", value: ref },
            connectors: peers.map((peer, i) => port(i, peer))
        });
        const pump = { uniqueId: "pump", elementId: 2, name: "Pump" };
        const read = { systemUniqueId: "sys", systems: [{ uniqueId: "sys", elementId: 3, name: "HW", domain: "piping", classification: "Supply",
                    systemType: { state: "Value", value: ref }, flowCubicFeetPerSecond: v(0.02),
                    source: { state: "Value", value: { equipment: pump, baseConnectorId: 7, outConnectorIds: [], connectors: [port(7, "a")] } } }],
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
});
