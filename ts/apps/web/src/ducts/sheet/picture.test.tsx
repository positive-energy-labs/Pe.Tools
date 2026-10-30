// @vitest-environment jsdom
/**
 * The sheet picture registers on attention through the shared `Picture`: a pick writes the page's
 * selection, which the document's attention then carries and the stage pivot follows; a hovered
 * worst path lights its legs. Fails if the
 * sheet ever mounts its picture without them again (the 2026-10-28 defect).
 */
import { createElement, type ComponentProps } from "react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { attention, elementKey, setHovered, type SubjectKey } from "@pe/kit/lang/attention";
import { makeAtomRegistry } from "#/route/route-owner";
import { AttentionRoot } from "#/attention";
import type { ModelPicture } from "#/scene/picture/model";
import type { PictureStage } from "#/scene/stage-controller";
import { boundsOfPoints } from "#/scene/orbit";
import { NAVIGATION_FIXTURE } from "../navigation.fixture";
import type { ProtoProps } from "../proto/props";
import type { OpenSheet } from "../sources";
import { beyondPicture, SheetPicture } from "./picture";

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
      return null;
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
afterEach(cleanup);

const { snapshot } = NAVIGATION_FIXTURE;
const [a, b, c] = snapshot.segments;
const sheet = {
  overview: { fan: { unitId: 999_001, portIndex: 0, mark: "AHU-1" }, totals: null, blockers: [] },
  inputs: null,
  elements: { walkedElementIds: [a!.id, b!.id] },
  legs: null,
  worstLegs: [{ pathId: "p1", legs: [{ elementId: a!.id }, { elementId: b!.id }] }],
} as unknown as OpenSheet;

function mount(open: OpenSheet = sheet, layers = ["meshes", "halo", "findings"]) {
  if (typeof ResizeObserver === "undefined")
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  const registry = makeAtomRegistry();
  const page = Atom.make({ selected: "", issue: "" });
  const selection = Atom.make(
    (get): ReadonlySet<SubjectKey> =>
      new Set(get(page).selected ? [elementKey(get(page).selected)] : []),
  );
  const setPage = vi.fn();
  const pageOf = () => ({
    ...registry.get(page),
    viewport: null,
    layers,
    sceneView: { preset: "all", section: null },
    contextRadiusFt: 10,
    contextStyle: "glass",
    picture: "model",
    encoding: "health",
  });
  const props = () =>
    ({
      page: pageOf(),
      setPage,
      selection,
      work: { doc: null, revision: null, write: () => {}, preview: null },
      priced: null,
      captureSource: null,
      doc: null,
      reading: { pending: false, error: null, refreshing: false },
    }) as unknown as ProtoProps;
  const tree = () => (
    <RegistryContext value={registry}>
      <AttentionRoot doc="d">
        <SheetPicture
          props={props()}
          snapshot={snapshot}
          sheet={open}
          blockers={[]}
          renderPane={(body) => body}
        />
      </AttentionRoot>
    </RegistryContext>
  );
  const view = render(tree());
  return { registry, page, setPage, rerender: () => view.rerender(tree()) };
}

it("a pick writes the page's selection and the stage pivot follows it", () => {
  const { registry, page, setPage, rerender } = mount();
  expect(seen.stage!.selectedBounds).toBeNull();
  act(() => seen.model!.onPick(a!.id, { x: 0, y: 0 }));
  expect(setPage).toHaveBeenCalledWith({ selected: String(a!.id), issue: "" }, { history: "push" });
  // The route derives the selection atom from the page it just wrote.
  act(() => registry.set(page, { selected: String(a!.id), issue: "" }));
  rerender();
  // Registered for the document: rows elsewhere (the ledger) read the same selection.
  expect([...registry.get(attention("d")).selected]).toEqual([elementKey(a!.id)]);
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
  const { registry } = mount(beyondSheet, ["meshes", "halo", "findings"]);
  act(() => setHovered(registry, { doc: "d", key: elementKey(c!.id) }));
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
