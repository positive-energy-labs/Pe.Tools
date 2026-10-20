import type { IssueKind } from "@pe/ducts-domain/issues";
// @vitest-environment jsdom
/**
 * /ducts spatial views, deterministic: the plan and the isometric draw the subject group over a
 * small slice shaped like the project-a snapshot (one supply group, a riser, every issue kind,
 * another group as context), and the encoding table inks health from `ISSUE_KINDS` alone.
 */
import { existsSync, readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";

import { VERDICT_INK } from "@pe/kit/table/cells";
import {
  encodingFor,
  ENCODING_KEYS,
  quantileEdges,
  strokeOf,
  type Issue,
  type Segment,
} from "./encoding";
import { ISSUE_KINDS } from "./issues";
import { gridAngle, isoProject } from "./iso";
import type { DuctsPage } from "./manifest";
import { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { DuctsSpatial } from "./spatial";

let resizeDrawing: (width: number, height: number) => void;
beforeAll(() => {
  // jsdom lays nothing out; the drawing sizes itself from its observer.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      resizeDrawing = (width, height) =>
        this.callback(
          [{ contentRect: { width, height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      this.callback(
        [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const L1 = 30;
const L2 = 9946;
const segment = (
  id: number,
  from: number[],
  to: number[],
  patch: Partial<Segment> = {},
): Segment => ({
  id,
  kind: "duct",
  curveKind: "line",
  shape: "round",
  size: '8"ø',
  diameterIn: 8,
  lengthFt: Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!),
  polyline: [from, to],
  levelId: L1,
  groupId: "g1",
  systemName: "SA 1",
  classification: "Supply Air",
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [],
  ...patch,
});

const KINDS = Object.keys(ISSUE_KINDS) as IssueKind[];
const issues: Issue[] = KINDS.map((kind, i) => ({
  id: `${kind}:g1:${100 + i}`,
  kind,
  // Group-level kinds name no element; they still carry a point.
  elementId: kind === "no-root" || kind === "multi-root" ? null : 100 + (i % 3),
  point: [i * 2, 0, 1],
  groupId: "g1",
  note: kind,
}));

const slice = {
  coordinateEncoding: "native-double",
  document: {
    title: "slice",
    readAt: "2026-09-26T00:00:00Z",
    elapsedMs: 1,
    networkBasedCalculations: false,
  },
  levels: [
    { id: L1, name: "Level 1", elevationFt: 0 },
    { id: L2, name: "Level 2", elevationFt: 12.5 },
  ],
  groups: [
    {
      id: "g1",
      rootIds: [9],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 1,
      elementCount: 9,
      loops: 0,
      issueIds: issues.map((issue) => issue.id),
    },
    {
      id: "g2",
      rootIds: [],
      classifications: ["Return Air"],
      systemNames: ["RA 1"],
      terminalCount: 0,
      elementCount: 1,
      loops: 0,
      issueIds: [],
    },
  ],
  nodes: (["equipment", "terminal", "fitting", "accessory", "cap"] as const).map((kind, i) => ({
    id: kind === "equipment" ? 9 : 200 + i,
    kind,
    category: kind,
    point: [i * 5, 0, 1],
    levelId: L1,
    groupId: kind === "equipment" ? null : "g1",
    connectors: [],
    facts: [],
  })),
  segments: [
    segment(100, [0, 0, 1], [20, 0, 1], { revit: { flowCfm: 400, velocityFpm: 1200 } }),
    segment(101, [20, 0, 1], [20, 20, 1]),
    segment(102, [20, 20, 1], [20, 20, 13], { lengthFt: 12 }),
    segment(103, [20, 20, 13], [40, 20, 13], { levelId: L2 }),
    // The other group: faint context, one path on its level.
    segment(104, [0, 40, 1], [30, 40, 1], { groupId: "g2" }),
  ],
  flows: [{ segmentId: 101, cfm: 150, provenance: "derived" }],
  issues,
  systems: [],
  slots: {
    fanStatic: "PE_M_Fan_ExternalStaticPressure",
    fanFlow: "PE_M_Fan_AirFlow",
    componentDrop: "Pressure Drop",
    fittingCoefficient: "Pe_C",
  },
  layers: [
    {
      key: "issues",
      title: "Issues",
      query: "derived",
      coverage: { have: 1, of: 2 },
      provenance: "derived",
    },
  ],
} as DuctSnapshot;

/** No staged assumption: the Work as the contract parses an empty document. */
const EMPTY_WORK = ductsRouteState.schema.parse({ assumptions: {} });

const page = (patch: Partial<DuctsPage>): DuctsPage => ({
  stage: "survey",
  view: "plan",
  group: "g1",
  level: "",
  layers: [],
  selected: "",
  issue: "",
  encoding: "health",
  scene: "",
  epoch: 0,
  evaluation: null,
  ...patch,
});

const spatial = (snapshot: DuctSnapshot, patch: Partial<DuctsPage>) => (
  <DuctsSpatial
    snapshot={snapshot}
    ready={readiness(snapshot, EMPTY_WORK)}
    priced={null}
    page={page(patch)}
    setPage={() => {}}
    empty={null}
  />
);
const draw = (snapshot: DuctSnapshot, patch: Partial<DuctsPage>) =>
  render(spatial(snapshot, patch)).container;

const kindsDrawn = (root: Element) =>
  new Set([...root.querySelectorAll("[data-issue]")].map((el) => el.getAttribute("data-issue")));

it("the plan draws the subject on its busiest level, its riser as a glyph, and every issue kind", () => {
  const root = draw(slice, { view: "plan" });
  const segments = [...root.querySelectorAll("[data-segment]")].map((el) =>
    Number(el.getAttribute("data-segment")),
  );
  expect(segments.sort((a, b) => a - b)).toEqual([100, 101, 102]);
  expect(root.querySelector('[data-riser="102"]')).not.toBeNull();
  expect(root.querySelectorAll("[data-context]")).toHaveLength(1);
  expect(kindsDrawn(root)).toEqual(new Set(KINDS));
  expect(root.querySelectorAll("[data-node]")).toHaveLength(5);
});

it("the isometric draws the subject on every level, with the other group as faint context", () => {
  const root = draw(slice, { view: "iso" });
  expect(root.querySelectorAll("[data-segment]")).toHaveLength(4);
  // Vertical is drawn as a line in iso, never a riser glyph.
  expect(root.querySelector("[data-riser]")).toBeNull();
  expect(root.querySelectorAll("[data-context]").length).toBeGreaterThan(0);
  expect(kindsDrawn(root)).toEqual(new Set(KINDS));
});

it("the drawing refits when the facts pane changes its available size", () => {
  const root = draw(slice, { view: "iso" });
  const matrix = () => root.querySelector('g[transform^="matrix"]')!.getAttribute("transform");
  const before = matrix();
  act(() => resizeDrawing(400, 600));
  expect(root.querySelector('svg[aria-label="isometric"]')!.getAttribute("width")).toBe("400");
  expect(matrix()).not.toBe(before);
});

it("health inks every ISSUE_KINDS entry in its class's tone, and every encoding bins every segment", () => {
  const facts = (kind: IssueKind) => ({
    segment: slice.segments[0]!,
    derivedCfm: null,
    issues: [{ ...issues[0]!, kind }],
  });
  for (const kind of KINDS)
    expect(strokeOf(encodingFor("health"), facts(kind)).ink).toBe(
      VERDICT_INK[ISSUE_KINDS[kind].color.tone],
    );
  for (const key of ENCODING_KEYS)
    for (const s of slice.segments) {
      const encoding = encodingFor(key, {
        segments: slice.segments.map((segment) => ({ segment, derivedCfm: null, issues: [] })),
        nodes: [],
      });
      const bin = encoding.bin({ segment: s, derivedCfm: null, issues: [] });
      expect(encoding.bins[bin], `${key} bin ${bin}`).toBeDefined();
    }
  expect(encodingFor("revit-pressure-drop").bin(facts("stub"))).toBe("missing");
});

it("a quantity's breaks are equal-count over the group, its top is the group's max, and it names the max element", () => {
  expect(quantileEdges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([3, 5, 7, 9]);
  expect(quantileEdges([4, 4, 4, 4], 5)).toEqual([]);
  const velocities = [300, 600, 900, 1200, 2400];
  const encoding = encodingFor("velocity", {
    segments: velocities.map((v, i) => ({
      segment: { ...slice.segments[0]!, id: 900 + i, revit: { velocityFpm: v } },
      derivedCfm: null,
      issues: [],
    })),
    nodes: [],
  });
  expect(encoding.quantity).toMatchObject({ max: 2400, maxId: 904, min: 300, unit: "fpm" });
  const seg = (v: number) => ({ segment: { ...slice.segments[0]!, revit: { velocityFpm: v } }, issues: [] });
  // The top bin holds the max; a lower value lands lower.
  expect(encoding.bin(seg(2400))).toBe(`b${encoding.quantity!.edges.length}`);
  expect(encoding.bin(seg(300))).toBe("b0");
});

it("a new encoding recolours the drawing and never moves its camera", () => {
  const view = render(spatial(slice, { view: "iso", encoding: "health" }));
  const matrix = () =>
    view.container.querySelector('g[transform^="matrix"]')!.getAttribute("transform");
  const before = matrix();
  view.rerender(spatial(slice, { view: "iso", encoding: "size" }));
  expect(matrix()).toBe(before);
});

it("the isometric turns the group's own grid onto the diagonal", () => {
  const rotated = [segment(1, [0, 0, 0], [10, 10, 0]), segment(2, [0, 0, 0], [-10, 10, 0])];
  expect(gridAngle(rotated)).toBeCloseTo(45);
  const [x, y] = isoProject(0, [0, 0, 0], 1)([0, 0, 10]);
  expect(x).toBeCloseTo(0);
  expect(y).toBeLessThan(0);
});

// The client model stays outside git; the dev knob `PE_DUCTS_FIXTURE` names it (vite.config.ts).
const FIXTURE = process.env.PE_DUCTS_FIXTURE ?? "";
it.skipIf(!FIXTURE || !existsSync(FIXTURE))(
  "project-a: the largest supply group draws in both views",
  () => {
    const snapshot = JSON.parse(readFileSync(FIXTURE, "utf8")) as DuctSnapshot;
    for (const view of ["plan", "iso"]) {
      const root = draw(snapshot, { view, group: "g6702175" });
      expect(root.querySelectorAll("[data-segment]").length).toBeGreaterThan(0);
      cleanup();
    }
  },
);
