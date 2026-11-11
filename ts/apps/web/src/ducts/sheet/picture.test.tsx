// @vitest-environment jsdom
/**
 * The sheet picture registers on attention through the shared `Picture`: a pick writes the page's
 * selection, which the document's attention then carries and the stage pivot follows; a hovered
 * worst path lights its legs. Fails if the
 * sheet ever mounts its picture without them again (the 2026-10-28 defect).
 */
import { AttentionRoot } from "#/attention";
import { ElementIndexContext } from "#/element-index";
import { selectedKeys } from "../cell-focus";
import { ductElements } from "./../identity";
import { boundsOfPoints } from "#/scene/orbit";
import type { ModelPicture } from "#/scene/picture/model";
import type { PictureStage } from "#/scene/stage-controller";
import { renderPicturePane } from "#/scene/picture/picture";
import { SceneMeshes } from "#/scene/types";
import { makeAtomRegistry } from "#/shell/owner";
import { RegistryContext } from "@effect/atom-react";
import { attention, setHovered, type SubjectKey } from "@pe/kit/lang/attention";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as Atom from "effect/reactivity/Atom";
import { createElement, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { NAVIGATION_FIXTURE } from "../navigation.fixture";
import { openFanSheetSchema as openSheetSchema } from "@pe/agent-contracts";
import type { OpenSheet } from "./types.ts";
import sheetFixture from "./sheet.fixture.json";
import { type FanPort } from "./model";
import type { SheetPictureProps } from "./picture";
import { beyondPicture, SheetPicture } from "./picture";

const io = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("#/scene/artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
vi.mock("#/scene/psc1", () => ({
  SCENE_FORMAT: "space-scene-v2",
  decodeScene: () => ({
    meshes: new SceneMeshes(
      new Float32Array(),
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      [],
    ),
    metadata: {
      elements: [],
      stamp: { sources: [] },
      omittedElements: 0,
      unavailableElements: [],
      completeness: { complete: true },
    },
  }),
}));
const seen = vi.hoisted(() => ({
  model: null as Parameters<typeof ModelPicture>[0] | null,
  stage: null as ComponentProps<typeof PictureStage> | null,
}));
vi.mock("#/scene/picture/model", async (original) => {
  const module = await original<typeof import("#/scene/picture/model")>();
  return {
    ...module,
    ModelPicture: (props: Parameters<typeof ModelPicture>[0]) => {
      seen.model = props;
      return <div data-drawn={!!props.read.meshes && !props.read.pending} />;
    },
  };
});
vi.mock("#/scene/stage-controller", async (original) => {
  const module = await original<typeof import("#/scene/stage-controller")>();
  return {
    ...module,
    PictureStage: (props: ComponentProps<typeof PictureStage>) => {
      seen.stage = props;
      return createElement(module.PictureStage, props);
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  io.call.mockReset();
});

const { snapshot } = NAVIGATION_FIXTURE;
const [a, b, c] = snapshot.segments;
const elements = ductElements(snapshot);
const sheet = {
  overview: { fan: { unitId: 999_001, portIndex: 0, mark: "AHU-1" }, totals: null, blockers: [] },
  inputs: null,
  elements: { walkedElementIds: [a!.id, b!.id] },
  legs: null,
  worstLegs: [{ pathId: "p1", legs: [{ elementId: a!.id }, { elementId: b!.id }] }],
} as unknown as OpenSheet;

function mount(
  open: OpenSheet | null = sheet,
  layers = ["meshes", "findings"],
  fans?: FanPort[],
  full = false,
) {
  const sceneSession = crypto.randomUUID();
  if (typeof ResizeObserver === "undefined")
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback(
            [
              {
                target,
                contentRect: new DOMRectReadOnly(0, 0, 640, 480),
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            this,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  const registry = makeAtomRegistry();
  const page = Atom.make({ selected: "", issue: "" });
  const selection = Atom.make(
    (get): ReadonlySet<SubjectKey> =>
      new Set(selectedKeys([get(page).selected])),
  );
  const setPage = vi.fn();
  const pageOf = () => ({
    ...registry.get(page),
    viewport: null,
    layers,
    sceneView: { preset: "all" as const, section: null },
    contextRadiusFt: 10,
    context: "glass" as const,
    picture: "model" as const,
    encoding: "health",
  });
  const props = (): SheetPictureProps => ({
    page: pageOf(),
    setPage,
    selection,
    work: { doc: null },
    captureSource: fans
      ? { document: { session: sceneSession, openId: "doc" }, version: "roster-1" }
      : null,
    doc: fans ? { session: sceneSession, openId: "doc" } : null,
    refreshing: false,
  });
  const tree = () => (
    <RegistryContext value={registry}>
      <ElementIndexContext value={elements}>
      <AttentionRoot doc="d">
        <SheetPicture
          props={props()}
          snapshot={snapshot}
          sheet={open}
          fans={fans}
          systemFans={() => []}
          blockers={[]}
          renderPane={full ? renderPicturePane : (body) => body}
        />
      </AttentionRoot>
      </ElementIndexContext>
    </RegistryContext>
  );
  const view = render(tree());
  return { ...view, registry, page, setPage, rerender: () => view.rerender(tree()) };
}

it("a pick writes the page's selection and the stage pivot follows it", () => {
  const { registry, page, setPage, rerender } = mount();
  expect(seen.stage!.selectedBounds).toBeNull();
  act(() => seen.model!.onPick(a!.id, { x: 0, y: 0 }));
  expect(setPage).toHaveBeenCalledWith({ selected: elements.keyOf(a!.id)!, issue: "" }, { history: "push" });
  // The route derives the selection atom from the page it just wrote.
  act(() => registry.set(page, { selected: elements.keyOf(a!.id)!, issue: "" }));
  rerender();
  // Registered for the document: rows elsewhere (the ledger) read the same selection.
  expect([...registry.get(attention("d")).selected]).toEqual([elements.keyOf(a!.id)]);
  expect([...seen.model!.selected]).toEqual([a!.id]);
  expect(seen.stage!.selectedBounds).toEqual(boundsOfPoints(a!.polyline));
});

it("a hovered worst path lights its legs", () => {
  const { registry } = mount();
  act(() => setHovered(registry, { doc: "d", key: "path:p1" }));
  expect([...seen.model!.lit].sort((x, y) => x - y)).toEqual([a!.id, b!.id].sort((x, y) => x - y));
});

// Context only (kaitpw 2026-10-30, "yes show"): the network past a unit this fan stops at.
const beyondSheet = {
  ...sheet,
  elements: {
    walkedElementIds: [a!.id, b!.id],
    beyond: [
      {
        unitId: 6105264,
        mark: "RV-15",
        elementIds: [b!.id, c!.id],
        cuts: [{ id: c!.id, from: [0, 0, 0], at: [1, 0, 0] }],
      },
    ],
  },
} as unknown as OpenSheet;

it("beyond draws only while context is, cut where the host cut it, and never on this fan's walk", () => {
  const walked = new Set([a!.id, b!.id]);
  const beyond = beyondSheet.elements!.beyond;
  expect([...beyondPicture(beyond, walked, true).ids]).toEqual([c!.id]);
  expect(beyondPicture(beyond, walked, true).markOf.get(c!.id)).toBe("RV-15");
  expect([...beyondPicture(beyond, walked, true).cuts.keys()]).toEqual([c!.id]);
  expect(beyondPicture(beyond, walked, false).ids.size).toBe(0);
});

it("hovering a context element names whose air it is and that this fan's calc leaves it out", () => {
  const { registry } = mount(beyondSheet, ["meshes", "findings"]);
  act(() => setHovered(registry, { doc: "d", key: elements.keyOf(c!.id)! }));
  const readout = render(<>{seen.model!.readout}</>);
  expect(readout.container.textContent).toContain(
    "beyond RV-15 (its own fan); not in this fan's calc",
  );
  // A context element paints as the network stage's one-hop neighbour stub, never as a subject.
  const paint = seen.model!.paint?.(null);
  expect(paint?.({ revitId: c!.id, focus: true, category: "Ducts" } as never)).toMatchObject({
    tier: "stub",
    neighbour: true,
  });
  expect(paint?.({ revitId: a!.id, focus: true, category: "Ducts" } as never)).toMatchObject({
    tier: "subject",
  });
});



it("reads a selected duct and run from the current sheet, including missing data and provenance", () => {
  const leg = { ...sheetFixture.legs.legs[0], elementId: a!.id, flowCfm: 120, velocityFpm: null };
  const emptySide = { runs: [], sections: [], worstKnownInWg: null, elementSections: {} };
  const open = openSheetSchema.parse({
    ...sheetFixture,
    elements: { ...sheetFixture.elements, walkedElementIds: [a!.id], beyond: [] },
    worstLegs: [],
    worksheet: {
      target: sheetFixture.legs.target,
      basis: "picture-readout",
      kind: "worksheet",
      limits: { supplyFpm: 900, returnFpm: 700, source: "firm" },
      legs: { [leg.id]: leg },
      supply: {
        ...emptySide,
        runs: [
          {
            id: "r1",
            side: "supply",
            end: { kind: "terminal", elementId: a!.id },
            legIds: [leg.id],
            sectionIds: [],
            cfm: 120,
            telFt: 12,
            knownInWg: 0.012,
            complete: false,
            residualInWg: null,
            critical: true,
            maxFpm: null,
            overLegIds: [],
          },
        ],
      },
      return: emptySide,
    },
  });
  const view = mount(open);
  act(() => view.registry.set(view.page, { selected: elements.keyOf(a!.id)!, issue: "" }));
  view.rerender();
  const duct = render(<>{seen.model!.readout}</>);
  expect(duct.container.querySelector(`[data-facts="${a!.id}"]`)).not.toBeNull();
  const facts = duct.container.querySelector(`[data-leg-facts="${leg.id}"]`)!;
  expect(facts.textContent).toContain("120 cfm");
  expect(facts.textContent).toContain("missing fpm");
  expect(facts.textContent).toContain("friction: galvanized");
  duct.unmount();
  act(() => view.registry.set(view.page, { selected: "run:r1", issue: "" }));
  view.rerender();
  const run = render(<>{seen.model!.readout}</>);
  expect(run.container.querySelector('[data-run-facts="r1"]')?.textContent).toContain(
    "0.0120 in-wg known",
  );
  expect(run.container.textContent).toContain("incomplete");
});

it("restores all nine encodings and makes a choice draw its centrelines through Page", async () => {
  const view = mount(sheet, ["meshes"], undefined, true);
  fireEvent.click(view.getByRole("button", { name: "lines show health" }));
  for (const label of [
    "none",
    "health",
    "size",
    "flow",
    "velocity (Revit)",
    "pressure drop (Revit)",
    "loss (Pe)",
    "legs",
    "provenance",
  ])
    expect((await view.findAllByText(label, { exact: true })).length).toBeGreaterThan(0);
  fireEvent.click(view.getByText("size", { exact: true }));
  expect(view.setPage).toHaveBeenLastCalledWith(
    { encoding: "size", layers: ["meshes", "centrelines"] },
    { history: "push" },
  );
});
