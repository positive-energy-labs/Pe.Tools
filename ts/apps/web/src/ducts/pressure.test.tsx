// @vitest-environment jsdom
/** Receipt-to-surface contract: losses, uncertainty, dependency disclosure and staged-only edits. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { applyPatches, ductsRouteState, type DuctsRouteDocument } from "@pe/agent-contracts";
import { NumericAssumptions } from "./assumptions";
import { ENCODINGS, strokeOf } from "./encoding";
import { savedReading } from "./host";
import { PRESSURE_ISSUE_KINDS } from "./issues";
import type { DuctsPage } from "./manifest";
import { pressurePoints, type Pressure } from "./pressure";
import { PressureBudget, PressureFacts } from "./pressure-facts";
import { readiness, type DuctSnapshot } from "./readiness";
import { DuctsSpatial } from "./spatial";
import { DuctsTree } from "./tree";

const used = [
  {
    id: "fitting:unmatched",
    value: "1",
    source: "Default" as const,
    reason: "assumed-one-velocity-head; screening, not a rated coefficient",
  },
  {
    id: "flex:roughness",
    value: "0.00328",
    source: "Default" as const,
    reason: "fully extended fabric flex; low-end 1 mm scenario",
  },
];
const ports = (neighbors: number[], x: number) =>
  neighbors.map((id, index) => ({
    index,
    kind: "end" as const,
    point: [x, 0, 0],
    direction: "out" as const,
    shape: "round" as const,
    size: "8 in",
    connectedTo: { elementId: id, connector: 0 },
  }));
const node = (
  id: number,
  kind: DuctSnapshot["nodes"][number]["kind"],
  neighbors: number[],
  x: number,
) => ({
  id,
  kind,
  category: kind,
  family: kind,
  point: [x, 0, 0],
  groupId: id === 100 ? null : "g1",
  levelId: 30,
  connectors: ports(neighbors, x),
  facts: [{ key: "flow", value: 100, unit: "cfm", provenance: "designer-stated" as const }],
});
const segment = (id: number, from: number, to: number, length: number) => ({
  id,
  kind: "flex" as const,
  type: "Fabric",
  groupId: "g1",
  levelId: 30,
  shape: "round" as const,
  size: "8 in",
  lengthFt: length,
  polyline: [
    [0, id, 0],
    [length, id, 0],
  ],
  roughness: { valueFt: 0.0003, provenance: "revit-default" as const },
  revit: {},
  connectors: [
    { ...ports([from], 0)[0]!, point: [0, id, 0] },
    { ...ports([to], length)[0]!, index: 1, point: [length, id, 0] },
  ],
});
const interval = (id: number, start: number, end: number, loss: number) => ({
  segmentId: id,
  groupId: "g1",
  startFt: start,
  endFt: end,
  flowCfm: 100,
  isComplete: true,
  assumptionsUsed: ["flex:roughness"],
  friction: {
    velocityFpm: 500,
    reynoldsNumber: 10000,
    frictionFactor: 0.02,
    hydraulicDiameterFt: 0.5,
    velocityPressureInWg: 0.02,
    frictionInWgPer100Ft: 0.1,
    pressureDropInWg: loss,
  },
});
const terminal = (id: number, path: number[], loss: number) => ({
  terminalId: id,
  rootId: 100,
  groupId: "g1",
  path,
  ductLossInWg: loss,
  effectiveLengthFt: 100,
  isComplete: true,
  assumptionsUsed: used.map((a) => a.id),
});
const pressure: Pressure = {
  segments: [
    interval(1, 0, 4, 0.04),
    interval(1, 4, 10, 0.06),
    interval(3, 0, 10, 0.1),
    interval(5, 0, 30, 0.05),
  ],
  fittings: [1, 2].map((outletConnector) => ({
    fittingId: 2,
    outletConnector,
    groupId: "g1",
    path: "Branch",
    flowRatio: 0.5,
    areaRatio: 0.5,
    coefficient: 1,
    pressureDropInWg: outletConnector === 1 ? 0.2 : 0.03,
    equivalentLengthFt: 20,
    coefficientRow: "assumed-one-velocity-head",
    isComplete: true,
    assumptionsUsed: ["fitting:unmatched"],
  })),
  terminals: [terminal(4, [100, 1, 2, 3, 4], 0.4), terminal(6, [100, 1, 2, 5, 6], 0.18)],
  groups: [
    {
      groupId: "g1",
      isWalkable: true,
      criticalPath: terminal(4, [100, 1, 2, 3, 4], 0.4),
      criticalPathIncludesComponents: false,
      pathEffectiveLengthFt: 100,
      assumptionsUsed: used.map((a) => a.id),
    },
  ],
  issues: [
    {
      code: "unmatched-fitting",
      groupId: "g1",
      elementId: 2,
      reason: "No sourced coefficient matches.",
    },
  ],
  assumptionsUsed: used,
};
const snapshot: DuctSnapshot = {
  group: "g1",
  document: { title: "pressure slice", readAt: "2026-09-26", elapsedMs: 1 },
  groups: [
    {
      id: "g1",
      rootIds: [100],
      rootNames: ["Fan"],
      classifications: ["Exhaust Air"],
      systemNames: [],
      terminalCount: 2,
      elementCount: 6,
      segmentCount: 3,
      loops: 0,
      designCfm: 200,
      issueCounts: [],
    },
  ],
  nodes: [
    node(100, "equipment", [1], 0),
    node(2, "fitting", [1, 3, 5], 10),
    node(4, "terminal", [3], 20),
    node(6, "terminal", [5], 40),
  ],
  segments: [segment(1, 100, 2, 10), segment(3, 2, 4, 10), segment(5, 2, 6, 30)],
  levels: [{ id: 30, name: "Level 1", elevationFt: 0 }],
  flows: [],
  issues: [],
  layers: [],
  pressure,
};
const page: DuctsPage = {
  group: "g1",
  view: "iso",
  level: "",
  selected: "",
  issue: "",
  encoding: "pressure-drop",
  layers: [],
  epoch: 0,
  stage: "survey",
};
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("projection sums intervals and the chosen fitting outlet, never sibling branches, including reversed taps", () => {
  const points = pressurePoints(snapshot, "g1");
  expect(points.get(4)?.atPoint).toBeCloseTo(0.4);
  expect(points.get(6)?.atPoint).toBeCloseTo(0.18);
  expect(points.get(2)?.drop).toBe(0.2);
  expect(points.get(2)?.atPoint).toBeCloseTo(0.3);
  expect(points.get(4)?.pointAssumptions).toEqual(["flex:roughness", "fitting:unmatched"]);
  const tapped = structuredClone(snapshot);
  tapped.segments[0]!.connectors[1]!.point[0] = 4;
  expect(pressurePoints(tapped, "g1").get(4)?.atPoint).toBeCloseTo(0.34);
  tapped.segments[0]!.connectors[0]!.point[0] = 10;
  expect(pressurePoints(tapped, "g1").get(4)?.atPoint).toBeCloseTo(0.36);
});

test("both pressure encodings draw segments and fittings, mark missing values, and outline the critical path in plan and iso", () => {
  const s = structuredClone(snapshot);
  s.segments.push(segment(9, 100, 4, 5));
  for (const view of ["plan", "iso"])
    for (const encoding of ["pressure-drop", "pressure-at-point"] as const) {
      const rendered = render(
        <DuctsSpatial
          snapshot={s}
          ready={readiness(s, null)}
          page={{ ...page, view, encoding }}
          setPage={() => {}}
          empty={null}
        />,
      );
      expect(rendered.container.querySelector('[data-segment="1"] .dash-void')).toBeNull();
      expect(rendered.container.querySelector('[data-segment="9"] .dash-void')).not.toBeNull();
      expect(rendered.container.querySelector('[data-node-id="2"] .dash-void')).toBeNull();
      expect(rendered.container.querySelector('[data-segment="3"][data-critical]')).not.toBeNull();
      expect(rendered.container.querySelector('[data-segment="5"][data-critical]')).toBeNull();
      expect(strokeOf(ENCODINGS[encoding], { issues: [] }).dash).toBe("void");
      rendered.unmount();
    }
});

test("tree marks the pressure-critical terminal instead of the longer branch", () => {
  const rendered = render(
    <DuctsTree snapshot={snapshot} page={page} setPage={() => {}} empty={null} />,
  );
  expect(rendered.container.textContent).toContain("critical path to 4");
  expect(rendered.container.textContent).not.toContain("longest run");
  expect(rendered.container.querySelectorAll("[data-critical]").length).toBeGreaterThan(0);
});

test("pressure numbers disclose sources on selection, and unknown budget terms stay unknown", async () => {
  const rendered = render(
    <>
      <PressureBudget snapshot={snapshot} group="g1" />
      <PressureFacts pressure={pressure} point={pressurePoints(snapshot, "g1").get(2)} />
    </>,
  );
  expect(rendered.container.textContent).toContain("assumed-one-velocity-head");
  expect(rendered.container.textContent).toContain("fully extended fabric flex");
  expect(screen.getByRole("button", { name: /^available static: unknown/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^critical loss:/ }));
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain("Depends on"));
  expect(screen.getByRole("tooltip").textContent).toContain("Default");
  expect(screen.getByRole("tooltip").textContent).toContain("screening, not a rated coefficient");
});

test("the budget prints the solver's ASP, TEL, friction-rate equation and negative margin", () => {
  const s = structuredClone(snapshot);
  Object.assign(s.pressure!.groups[0]!, {
    availableStaticInWg: 0.3,
    totalEffectiveLengthFt: 200,
    frictionRateInWgPer100Ft: 0.15,
    marginInWg: -0.1,
  });
  render(<PressureBudget snapshot={s} group="g1" />);
  expect(screen.getByRole("button", { name: /^available static: 0.300/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^total effective length: 200.000/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^friction rate: 0.150/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^margin: -0.100/ })).toBeTruthy();
  expect(screen.getByText(/Friction rate = ASP × 100 \/ TEL/)).toBeTruthy();
});

test("numeric editors stage exact Work keys, preserve a proposal and explicit zero, and reject zero roughness", async () => {
  let doc: DuctsRouteDocument = ductsRouteState.schema.parse({
    assumptions: { "fan-static:100": { proposal: { value: { kind: "fan-static", inWg: 0.9 } } } },
  });
  const write = async (patches: import("@pe/agent-contracts").RouteStatePatch[]) => {
    const result = applyPatches(
      ductsRouteState,
      { version: 1, revision: 0, doc },
      "human",
      patches,
      0,
    );
    if (!result.ok) throw Error(result.error);
    doc = result.envelope.doc;
    return null;
  };
  const rendered = render(
    <NumericAssumptions snapshot={snapshot} group="g1" work={{ doc, write }} />,
  );
  const fan = screen.getByRole("spinbutton", { name: "fan-static:100" });
  fireEvent.change(fan, { target: { value: "0" } });
  fireEvent.click(
    within(fan.closest("[data-assumption]") as HTMLElement).getByRole("button", { name: "stage" }),
  );
  await waitFor(() =>
    expect(doc.assumptions["fan-static:100"]?.staged?.value).toEqual({
      kind: "fan-static",
      inWg: 0,
    }),
  );
  expect(doc.assumptions["fan-static:100"]?.proposal?.value).toEqual({
    kind: "fan-static",
    inWg: 0.9,
  });
  const flex = screen.getByRole("spinbutton", { name: "flex-roughness:Fabric" });
  fireEvent.change(flex, { target: { value: "0" } });
  expect(
    within(flex.closest("[data-assumption]") as HTMLElement)
      .getByRole("button", { name: "stage" })
      .hasAttribute("disabled"),
  ).toBe(true);
  rendered.rerender(<NumericAssumptions snapshot={snapshot} group="g1" work={{ doc, write }} />);
  fireEvent.click(
    within(fan.closest("[data-assumption]") as HTMLElement).getByRole("button", { name: "unset" }),
  );
  await waitFor(() => expect(doc.assumptions["fan-static:100"]?.staged).toBeNull());
});

test("saved fixture matching refuses uncomputed edits instead of publishing a stale pressure result", () => {
  const saved = {
    index: snapshot,
    scenarios: [
      { request: { group: "g1", assumptions: { revision: 0, values: {} } }, response: snapshot },
    ],
  };
  expect(
    savedReading(saved, { group: "g1", assumptions: { revision: 5, values: {} } }).pressure
      ?.assumptionRevision,
  ).toBe(5);
  expect(() =>
    savedReading(saved, {
      group: "g1",
      assumptions: { revision: 6, values: { "fan-static:100": { kind: "fan-static", inWg: 0.5 } } },
    }),
  ).toThrow("No saved pressure scenario");
  expect(() =>
    savedReading(snapshot, {
      group: "g1",
      assumptions: { revision: 1, values: { "fan-static:100": { kind: "fan-static", inWg: 0.5 } } },
    }),
  ).toThrow("no staged pressure scenarios");
});

test.skipIf(!process.env.PE_DUCTS_PRESSURE_FIXTURE)(
  "cumulative display agrees with every terminal loss in the saved production C# responses",
  () => {
    const bundle = JSON.parse(readFileSync(process.env.PE_DUCTS_PRESSURE_FIXTURE!, "utf8")) as {
      scenarios: { response: DuctSnapshot }[];
    };
    let checked = 0;
    for (const { response } of bundle.scenarios) {
      const points = pressurePoints(response, response.group!);
      for (const terminal of response.pressure!.terminals) {
        expect(
          points.get(terminal.terminalId)?.atPoint,
          `${response.group}:${terminal.terminalId}`,
        ).toBeCloseTo(terminal.ductLossInWg, 10);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  },
);

test("pressure issue taxonomy has parity with every production solver issue code", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../../../../dotnet/Pe.Shared.RevitData/Ducts/DuctPressureSolver.cs",
    ),
    "utf8",
  );
  const codes = [
    ...source.matchAll(
      /Issue\((?:"([a-z-]+)"|attachments.Count == 0 \? "([a-z-]+)" : "([a-z-]+)")/g,
    ),
  ].flatMap((m) => m.slice(1).filter(Boolean));
  expect([...new Set(codes)].sort()).toEqual(Object.keys(PRESSURE_ISSUE_KINDS).sort());
});
