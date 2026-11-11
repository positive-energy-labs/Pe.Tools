import { describe, expect, it } from "vite-plus/test";
import { groupOf, nodeOf, snapshotOf, systemOf } from "@pe/ducts-domain/test-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { mergeSnapshots, nextSystemsRead } from "@pe/ducts-domain/system-reads";

const part = (over: Partial<DuctSnapshot>) =>
  snapshotOf({
    document: {
      title: "Chadds",
      readAt: "2026-10-29T00:00:00Z",
      elapsedMs: 10,
      networkBasedCalculations: false,
    },
    ...over,
  });

const group = (id: string) => groupOf(id, { elementCount: 1 });
const sizes = (have: number, of: number): DuctSnapshot["layers"][number] => ({
  key: "sizes",
  title: "",
  query: "",
  coverage: { have, of },
  provenance: "geometry",
});

describe("nextSystemsRead", () => {
  it("reads the wanted systems not read yet, open ones first, a few at a time", () => {
    expect(nextSystemsRead([7, 3, 9, 1, 4, 5], new Set([3]), 4)).toEqual([7, 9, 1, 4]);
    expect(nextSystemsRead([7, 7, 3], new Set(), 4)).toEqual([7, 3]);
    expect(nextSystemsRead([7, 3], new Set([7, 3]))).toEqual([]);
  });
});

describe("mergeSnapshots", () => {
  it("joins reads by id, so a group two reads share counts once", () => {
    const a = part({
      groups: [group("g20"), group("g5")],
      nodes: [nodeOf(5, "fitting"), nodeOf(20, "fitting")],
      systems: [systemOf(2, { name: "SA-2" })],
      layers: [sizes(1, 2)],
    });
    const b = part({
      document: {
        title: "Chadds",
        readAt: "2026-10-29T00:01:00Z",
        elapsedMs: 15,
        networkBasedCalculations: false,
      },
      groups: [group("g20"), group("g100")],
      nodes: [nodeOf(20, "fitting"), nodeOf(100, "fitting")],
      systems: [systemOf(1, { name: "EA-1" })],
      layers: [sizes(3, 3)],
    });
    const merged = mergeSnapshots([a, b])!;
    expect(merged.groups.map((g) => g.id)).toEqual(["g5", "g20", "g100"]);
    expect(merged.nodes.map((n) => n.id)).toEqual([5, 20, 100]);
    expect(merged.systems.map((s) => s.name)).toEqual(["EA-1", "SA-2"]);
    expect(merged.layers[0]!.coverage).toEqual({ have: 4, of: 5 });
    expect(merged.document.elapsedMs).toBe(25);
    expect(merged.document.readAt).toBe("2026-10-29T00:01:00Z");
  });

  it("is the one read when there is one, and nothing when there is none", () => {
    const a = part({});
    expect(mergeSnapshots([a])).toBe(a);
    expect(mergeSnapshots([])).toBeNull();
  });
});
