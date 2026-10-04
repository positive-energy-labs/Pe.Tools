// @vitest-environment jsdom
/**
 * /ducts losses view over W1's synthetic snapshot (AHU 1 -> duct 10 -> tap 22 -> grille 31; duct 10
 * -> elbow 21 -> grille 30), deterministic: the bars draw both grilles, opening one shows the rules
 * on its path, a table chip stages a Work cell that moves the band and the fan, and the
 * `ducts.apply` request built from the staged cells is exact. Grids are inline test data.
 */
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vite-plus/test";
import {
  applyPatches,
  ductsRouteState,
  transitionPatches,
  type DuctsRouteDocument,
  semanticActions,
  type DuctsApplyInput,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import type { DuctsApply } from "@pe/host-contracts/generated";

import type { Grid, Grids } from "./loss-grid";
import { computeLosses } from "./losses";
import { DuctsLosses, StagedLosses } from "./losses-view";
import { manifest, type DuctsPage } from "./manifest";
import { applyRequest, price } from "./pricing";
import synthetic from "./fixtures/synthetic-snapshot.json";
import type { DuctSnapshot } from "./readiness";

afterEach(cleanup);

const snapshot = synthetic as unknown as DuctSnapshot;
const flat = (title: string, x: number[], grid: number[]): Grid => ({
  title,
  xLabel: "D",
  x,
  grid,
});
/** A tee grid that answers `value` everywhere. */
const even = (title: string, value: number): Grid => ({
  title,
  xLabel: "Qb/Qc",
  x: [0, 1],
  yLabel: "Ab/Ac",
  y: [0, 2],
  grid: [
    [value, value],
    [value, value],
  ],
});
const grids: Grids = {
  "CD3-21": {
    Co: flat(
      "CD3-21",
      [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 60],
      [0.6, 0.42, 0.34, 0.29, 0.26, 0.24, 0.22, 0.2, 0.19, 0.18, 0.13],
    ),
  },
  "CD3-2": { Co: flat("CD3-2", [3, 10], [0.5, 0.24]) },
  "SD5-9": { Cb: even("SD5-9 Cb", 1.38), Cs: even("SD5-9 Cs", 0.125) },
  "SD5-10": { Cb: even("SD5-10 Cb", 1), Cs: even("SD5-10 Cs", 0.1) },
};
const PAGE: DuctsPage = {
  stage: "losses",
  view: "losses",
  group: "",
  level: "",
  layers: [],
  selected: "",
  epoch: 0,
  evaluation: null,
};

function land(doc: DuctsRouteDocument, patches: RouteStatePatch[]) {
  const landed = applyPatches(
    ductsRouteState,
    { version: 1, revision: 0, doc },
    "human",
    patches,
    0,
  );
  if (!landed.ok) throw Error(JSON.stringify(landed));
  return landed.envelope.doc;
}

/** The view and the band over one in-memory Work, as the route wires them. */
function Harness() {
  const [page, setPageState] = useState(PAGE);
  const [doc, setDoc] = useState<DuctsRouteDocument>(() => ductsRouteState.schema.parse({}));
  const priced = price(snapshot, grids, doc);
  const work = {
    doc,
    revision: 0,
    write: async (patches: RouteStatePatch[]) => {
      setDoc((was) => land(was, patches));
      return null;
    },
  };
  const setPage = (next: Partial<DuctsPage>) => setPageState((was) => ({ ...was, ...next }));
  return (
    <>
      <StagedLosses
        snapshot={snapshot}
        grids={grids}
        priced={priced}
        evaluation={null}
        fresh={false}
        work={work}
        group=""
      />
      <DuctsLosses
        snapshot={snapshot}
        grids={grids}
        priced={priced}
        ready={{}}
        page={page}
        setPage={setPage}
        empty={null}
        work={work}
      />
    </>
  );
}

it("draws one bar per grille, opens a grille's rules, and a table chip stages the band and moves the fan", async () => {
  const view = render(<Harness />);
  const q = (selector: string) => view.container.querySelector(selector);
  const rowOf = (selector: string) => q(selector)!.closest("tr, [role=row]") as HTMLElement;
  // Both grilles, the longest first; Pe's fan beside Revit's critical path.
  const bars = [...view.container.querySelectorAll("[data-terminal]")].map((el) =>
    el.getAttribute("data-terminal"),
  );
  expect(bars).toEqual(["31", "30"]);
  expect(q('[data-fan="g10"]')?.textContent).toBe("0.0822");
  expect(q('[data-revit="g10"]')?.textContent).toBe("0.1000");
  // Grille 30 has no drop and a connector Revit refuses a drop on.
  const status30 = [...q('[data-terminal="30"]')!.querySelectorAll("[data-status]")].map((el) =>
    el.getAttribute("data-status"),
  );
  expect(status30).toEqual(["refuses"]);
  expect(q("[data-staged-band]")).toBeNull();
  // The slot a terminal drop travels in is a cell a person can name.
  expect(q('[data-slot="terminalDrop"]')).not.toBeNull();

  fireEvent.click(q('[data-terminal="31"]')!);
  const drawer = q('[data-drawer="31"]') as HTMLElement;
  expect(drawer).not.toBeNull();
  expect(q('[data-rule="tap-std"]')?.textContent).toContain("Round Takeoff : Standard");
  expect(q('[data-rule="elbow-1d-gt10"]')).toBeNull(); // the elbow is on grille 30's path only

  fireEvent.click(within(rowOf('[data-rule="tap-std"]')).getByText("SD5-10"));
  await view.findByText(/instances rewritten/);
  expect(q('[data-staged-rule="tap-std"]')?.textContent).toContain("SD5-9 → SD5-10");
  expect(q('[data-fanout="tap-std"]')?.textContent).toBe(
    "1 instances rewritten · 2 grilles moved · fan 0.0822 → 0.0761",
  );
  expect(q('[data-fan-next="g10"]')?.textContent).toContain("0.0761");
  expect(q('[data-ghost="31"]')).not.toBeNull();
  // Pressing the staged chip again takes it back.
  fireEvent.click(within(rowOf('[data-rule="tap-std"]')).getByText("SD5-10"));
  await view.findByText(/open a grille/);
  expect(q("[data-staged-band]")).toBeNull();
});

it("builds the ducts.apply request from the staged cells only, exactly", () => {
  let doc = ductsRouteState.schema.parse({});
  doc = land(
    doc,
    transitionPatches(
      ["rules"],
      "tap-std",
      {},
      { kind: "stage", rung: { value: { table: "SD5-10" } } },
    ),
  );
  doc = land(
    doc,
    transitionPatches(
      ["terminalDrops"],
      "31",
      {},
      { kind: "stage", rung: { value: { inWg: 0.08, source: "catalog" } } },
    ),
  );
  // A proposal never reaches Revit.
  doc = land(
    doc,
    transitionPatches(
      ["rules"],
      "elbow-1d-gt10",
      {},
      { kind: "propose", rung: { value: { table: "CD3-2" } } },
    ),
  );
  const at = "2026-10-04T00:00:00.000Z";
  const priced = price(snapshot, grids, doc);
  // T31: duct 10 + tap branch 1.0 x Pv(100 cfm, 6 in) + duct 12 + the staged 0.08 terminal drop.
  expect(
    computeLosses(snapshot, grids, priced.choices, priced.overrides).byGroup.g10?.fan,
  ).toBeCloseTo(0.1060651, 6);
  expect(applyRequest(snapshot, priced, at)).toEqual({
    slots: {},
    fittings: [
      {
        id: 22,
        coefficient: 1,
        table: "SD5-10",
        inputs: "Qb/Qc=0.25, Ab/Ac=0.25",
        ruleKey: "tap-std",
      },
    ],
    terminals: [{ id: 31, inWg: 0.08, source: "catalog" }],
    components: [],
    equipment: [{ id: 1, externalStaticInWg: 0.1061 }],
    networkBasedCalculations: true,
    store: {
      version: 1,
      rules: { "tap-std": { table: "SD5-10" } },
      instances: {
        "22": { table: "SD5-10", inputs: "Qb/Qc=0.25, Ab/Ac=0.25", coefficient: 1, appliedAt: at },
      },
      terminals: { "31": { inWg: 0.08, source: "catalog", appliedAt: at } },
      slots: {
        fanStatic: "PE_M_Fan_ExternalStaticPressure",
        fanFlow: "PE_M_Fan_AirFlow",
        componentDrop: "Pressure Drop",
      },
      workRevision: 0,
      appliedAt: at,
    },
  });
  // The request is what the semantic action admits, and with the verb's previewOnly it is the
  // generated native request.
  const wire: DuctsApply.Req.Request = { ...applyRequest(snapshot, priced, at), previewOnly: true };
  expect(wire.previewOnly).toBe(true);
  // Both directions: the semantic action's input is the generated request less previewOnly.
  const fromWire = ({ previewOnly: _, ...rest }: DuctsApply.Req.Request): DuctsApplyInput => rest;
  expect(fromWire(wire)).toEqual(applyRequest(snapshot, priced, at));
  expect(() =>
    semanticActions["ducts.apply-losses"].input.parse(applyRequest(snapshot, priced, at)),
  ).not.toThrow();
});

it("apply is armed only by a preview of this Work revision and this snapshot", () => {
  const doc = land(
    ductsRouteState.schema.parse({}),
    transitionPatches(
      ["rules"],
      "tap-std",
      {},
      { kind: "stage", rung: { value: { table: "SD5-10" } } },
    ),
  );
  const response = {
    previewOnly: true,
    writes: [],
    counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
    storeRevision: 0,
  };
  const ctx = (page: Partial<DuctsPage>, revision = 3) =>
    ({
      work: { doc, revision },
      page: { ...PAGE, ...page },
      readings: {
        ducts: { state: "ready", observation: snapshot },
        tables: { state: "ready", observation: grids },
      },
    }) as unknown as Parameters<NonNullable<typeof manifest.actions>["apply"]["ready"]>[0];
  const { apply, preview } = manifest.actions!;
  const nothing = undefined as unknown as Parameters<typeof apply.ready>[1];
  expect(preview.ready(ctx({}), nothing)).toBeNull();
  expect(apply.ready(ctx({}), nothing)).toBe("Preview first");
  const evaluation = { revision: 3, epoch: 0, response };
  expect(apply.ready(ctx({ evaluation }), nothing)).toBeNull();
  expect(apply.ready(ctx({ evaluation }, 4), nothing)).toMatch(/preview again/);
  expect(apply.ready(ctx({ evaluation, epoch: 1 }), nothing)).toMatch(/preview again/);
});

it("the band names a fan static that lands on the unit's type, and how many units it moves", () => {
  const doc = land(
    ductsRouteState.schema.parse({}),
    transitionPatches(
      ["rules"],
      "tap-std",
      {},
      { kind: "stage", rung: { value: { table: "SD5-10" } } },
    ),
  );
  const response: DuctsApply.Res.Response = {
    previewOnly: true,
    writes: [
      {
        id: 1,
        kind: "equipment",
        outcome: "planned",
        before: null,
        after: "type 'PE_ESP' 0.0761 in-wg",
      },
      {
        id: 31,
        kind: "terminal",
        outcome: "refused",
        reason:
          "the instance has no writable number parameter 'Catalog Drop' (the TerminalDrop slot)",
      },
    ],
    counts: { planned: 1, written: 0, refused: 1, unchanged: 0 },
    storeRevision: 0,
  };
  const view = render(
    <StagedLosses
      snapshot={snapshot}
      grids={grids}
      priced={price(snapshot, grids, doc)}
      evaluation={{ revision: 0, epoch: 0, response }}
      fresh
      work={{ doc, revision: 0, write: async () => null, preview: response }}
      group=""
    />,
  );
  expect(view.container.querySelector('[data-type-fanout="1"]')?.textContent).toBe(
    "unit 1: the instance has no fan static parameter, so apply writes type Air Handler : Standard · moves 1 unit",
  );
  expect(view.container.textContent).toContain(
    "terminal 31 refused: the instance has no writable number parameter",
  );
});
