// @vitest-environment jsdom
/**
 * /ducts spatial views, deterministic: the plan and the isometric draw the subject group over a
 * small slice shaped like the project-a snapshot (one supply group, a riser, every issue kind,
 * another group as context), and the encoding table inks health from `ISSUE_KINDS` alone.
 */
import { existsSync, readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";

import { VERDICT_INK } from "#/components/master-table/cells";
import {
  ENCODINGS,
  ENCODING_KEYS,
  strokeOf,
  type Encoding,
  type Issue,
  type Segment,
} from "./encoding";
import { ISSUE_KINDS, type IssueKind } from "./issues";
import { gridAngle, isoProject } from "./iso";
import type { DuctsPage } from "./manifest";
import { readiness, type DuctSnapshot } from "./readiness";
import { DuctsSpatial } from "./spatial";

beforeAll(() => {
  // jsdom lays nothing out; the drawing sizes itself from its observer.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
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
  document: { title: "slice", readAt: "2026-09-26T00:00:00Z", elapsedMs: 1 },
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
    segment(500, [0, 40, 1], [30, 40, 1], { groupId: "g2", systemName: "RA 1" }),
  ],
  flows: [{ segmentId: 101, cfm: 150, provenance: "derived" }],
  issues,
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
  epoch: 0,
  ...patch,
});

const draw = (snapshot: DuctSnapshot, patch: Partial<DuctsPage>) =>
  render(
    <DuctsSpatial
      snapshot={snapshot}
      ready={readiness(snapshot, EMPTY_WORK)}
      page={page(patch)}
      setPage={() => {}}
      empty={null}
    />,
  ).container;

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

it("health inks every ISSUE_KINDS entry in its class's tone, and every encoding bins every segment", () => {
  const facts = (kind: IssueKind) => ({
    segment: slice.segments[0]!,
    derivedCfm: null,
    issues: [{ ...issues[0]!, kind }],
  });
  for (const kind of KINDS)
    expect(strokeOf(ENCODINGS.health, facts(kind)).ink).toBe(
      VERDICT_INK[ISSUE_KINDS[kind].color.tone],
    );
  for (const key of ENCODING_KEYS)
    for (const s of slice.segments) {
      const encoding: Encoding = ENCODINGS[key];
      const bin = encoding.bin({ segment: s, derivedCfm: null, issues: [] });
      expect(encoding.bins[bin], `${key} bin ${bin}`).toBeDefined();
    }
  expect(ENCODINGS["revit-pressure-drop"].bin(facts("stub"))).toBe("missing");
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
