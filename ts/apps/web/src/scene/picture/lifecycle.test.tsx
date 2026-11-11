// @vitest-environment jsdom
import * as Atom from "effect/reactivity/Atom";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useWorkOwner, WorkContext } from "@pe/kit/lang/work";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { TestAttention, eKey } from "#/test-attention";
import { makeAtomRegistry } from "#/shell/owner";
import { SceneMeshes } from "../types";
import { Picture, renderPicturePane, type PictureContent } from "./picture";
import type { Scene3DProps } from "../scene3d";
import { ductsData as ductsGraph } from "#/ducts/route";
import { reduceLayout } from "../../../../../packages/kit/src/components/lang/layout-graph";
import type { LayoutNode } from "@pe/agent-contracts";

const io = vi.hoisted(() => ({ call: vi.fn(), orbit: null as Scene3DProps["orbit"] | null }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("../artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
vi.mock("../psc1", () => ({
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
// Capture, retention, status and ModelPicture are real; WebGL is the deterministic boundary.
vi.mock("../scene3d", () => ({
  Scene3D: ({ meshes, readout, orbit }: Scene3DProps) => {
    io.orbit = orbit;
    return <div data-rendered={!!meshes}>{readout}</div>;
  },
}));

const observers = new Map<Element, ResizeObserverCallback>();
afterEach(() => {
  cleanup();
  observers.clear();
  io.call.mockReset();
  vi.unstubAllGlobals();
});
const selection = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
const content: PictureContent = {
  focus: { walked: [7311], near: [] },
  lines: [],
  name: () => "duct",
  kinds: {},
  colour: "mono",
  layerOptions: [],
  readout: { summary: "fan ready" },
};
function Owner({ children }: { children: React.ReactNode }) {
  const owner = useWorkOwner();
  return (
    <WorkContext value={owner.register}>
      <output>{owner.labels.join(" / ")}</output>
      {children}
    </WorkContext>
  );
}
function mount(
  revision: string,
  refreshing = false,
  viewport: import("../orbit").OrbitViewport | null = null,
  ownContent = content,
  full = false,
  selected = "",
) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(element: Element) {
        observers.set(element, this.callback);
      }
      disconnect() {}
    },
  );
  const registry = makeAtomRegistry();
  const setPage = vi.fn();
  const tree = (refresh: boolean, native = true) => (
    <TestAttention registry={registry} ids={[7311]}>
      <Owner>
        <Picture
          selection={selection}
          source={{
            native: native ? { session: "picture-lifecycle", openId: "doc" } : null,
            doc: { session: "picture-lifecycle", openId: "doc" },
            version: revision,
            label: "fan sheet",
            refreshing: refresh,
          }}
          page={{
            selected,
            issue: "",
            encoding: "none",
            viewport: viewport && { ...viewport, pivot: [...viewport.pivot] },
            sceneView: { preset: "all", section: null },
            contextRadiusFt: 10,
            contextStyle: "glass",
            picture: "model",
            layers: full ? ownContent.layerOptions.map((l) => l.key) : ["meshes"],
          }}
          setPage={setPage}
          renderPane={full ? renderPicturePane : (body) => body}
          content={ownContent}
        />
      </Owner>
    </TestAttention>
  );
  const view = render(tree(refreshing));
  const resize = (width: number, height: number) =>
    act(() => {
      for (const [element, callback] of observers)
        callback(
          [{ target: element, contentRect: { width, height } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
    });
  return {
    ...view,
    setPage,
    resize,
    refresh: (value: boolean) => view.rerender(tree(value)),
    withhold: () => view.rerender(tree(true, false)),
  };
}

it("arms capture on growth from 0×0, renders, and re-arms after collapse during a capture", async () => {
  const resolvers: ((value: { id: string }) => void)[] = [];
  io.call.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const view = mount("zero-to-visible");
  view.resize(0, 0);
  expect(io.call).not.toHaveBeenCalled();
  view.resize(640, 480);
  await act(async () => {});
  expect(io.call).toHaveBeenCalledTimes(1);
  view.resize(0, 0);
  await act(async () => {});
  expect(io.call.mock.calls[0]![2].signal.aborted).toBe(true);
  view.resize(640, 480);
  await act(async () => {});
  expect(io.call).toHaveBeenCalledTimes(2);
  await act(async () => resolvers[1]!({ id: "grown-picture" }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-rendered="true"]')).not.toBeNull(),
  );
  expect(view.container.querySelector("output")!.textContent).toBe("");
  expect(view.container.querySelector("[data-picture]")!.getAttribute("aria-busy")).toBeNull();
});

it("clears capture words when capture settles, then refresh words when the reading settles", async () => {
  let resolve!: (value: { id: string }) => void;
  io.call.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = mount("status-settles", true);
  view.resize(640, 480);
  await act(async () => {});
  expect(view.container.querySelector("output")!.textContent).toContain("capturing meshes");
  await act(async () => resolve({ id: "settled-picture" }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-rendered="true"]')).not.toBeNull(),
  );
  expect(view.container.querySelector("output")!.textContent).not.toContain("capturing meshes");
  expect(view.container.textContent).toContain("refreshing");
  view.refresh(false);
  expect(view.container.textContent).not.toContain("refreshing");
  expect(view.container.querySelector("output")!.textContent).toBe("");
  view.withhold();
  expect(view.container.textContent).toContain("showing fan sheet");
  expect(view.container.querySelector('[data-rendered="true"]')).not.toBeNull();
  expect(view.container.querySelector("output")!.textContent).toBe("");
  view.refresh(false);
  expect(view.container.textContent).not.toContain("refreshing");
  expect(view.container.textContent).not.toContain("showing fan sheet");
});

it("reserves the network picture's width at 1600px even with expanded side panes", () => {
  const layout = reduceLayout(ductsGraph.layout as LayoutNode, (when) => when !== "sheet")!;
  const find = (
    node: LayoutNode,
    id: string,
  ): Extract<LayoutNode, { kind: "split" }> | undefined => {
    if (node.kind !== "split") return undefined;
    return node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
  };
  const sidebar = find(layout, "sidebar")!;
  const drawing = find(layout, "drawing")!;
  const pictureWidth = (sidebarSize: number, rulingsSize: number) => {
    const remaining = 1600 - Math.min(sidebarSize, 1600 - 8 - (sidebar.minOtherSize ?? 0)) - 8;
    return remaining - Math.min(rulingsSize, remaining - 8 - (drawing.minOtherSize ?? 0)) - 8;
  };
  expect(pictureWidth(sidebar.size, drawing.size)).toBe(824);
  expect(
    pictureWidth(sidebar.maxSize ?? Infinity, drawing.maxSize ?? Infinity),
  ).toBeGreaterThanOrEqual(360);
  expect(drawing.minOtherSize).toBe(360);
  expect(drawing.minSize).toBe(260);
});

it("keeps an in-flight orbit through equal Page re-projections and commits its released pose", async () => {
  io.call.mockResolvedValue({ id: "orbit-rerender" });
  const pose: import("../orbit").OrbitViewport = {
    kind: "orbit",
    yaw: 225,
    elev: 32,
    zoom: 1,
    pivot: [0, 0, 0],
  };
  const view = mount("orbit-rerender", false, pose);
  view.resize(640, 480);
  await act(async () => {});
  const orbit = io.orbit!;
  const gesture = orbit.begin();
  const next = { ...pose, yaw: 170, elev: 17 };
  act(() => orbit.preview(gesture, next));
  view.refresh(true);
  expect(orbit.owns(gesture)).toBe(true);
  expect(orbit.read()).toEqual(next);
  act(() => orbit.end(gesture));
  view.refresh(false);
  expect(orbit.read()).toEqual(next);
});

it("hosts globe, layers, real selected-group facts and one context box through the kernel picture adapter", async () => {
  io.call.mockResolvedValue({ id: "furniture" });
  const own: PictureContent = {
    ...content,
    lines: [
      {
        key: eKey(7311),
        points: [
          [0, 0, 0],
          [1, 1, 1],
        ],
      },
    ],
    members: new Map([["run:r1", [eKey(7311)]]]),
    name: (key) => (key === "run:r1" ? "Run to grille" : "Duct 7311"),
    readout: { summary: "fan ready", facts: (key) => <span data-read-facts={key}>120 cfm</span> },
    layerOptions: [
      { key: "meshes", label: "meshes" },
      { key: "context", label: "context" },
    ],
  };
  const view = mount("furniture", false, null, own, true, "run:r1");
  view.resize(640, 480);
  await waitFor(() => expect(io.orbit?.read()).not.toBeNull());
  expect(view.container.querySelector("[data-orbit-mini-lines]")).not.toBeNull();
  expect(view.container.querySelector('[data-read-facts="run:r1"]')?.textContent).toBe("120 cfm");
  expect(view.container.querySelector('[data-picture-readout="selection"]')).not.toBeNull();
  expect(view.container.querySelector('[aria-label="keys"]')).toBeNull();
  expect(view.container.querySelectorAll('[aria-label="section and context"]')).toHaveLength(1);
  expect(view.container.querySelector('[aria-label="scene completeness"]')).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "meshes" }));
  expect(view.setPage).toHaveBeenLastCalledWith({ layers: ["context"] }, { history: "push" });
  fireEvent.click(view.getByRole("button", { name: "off" }));
  expect(view.setPage).toHaveBeenLastCalledWith({ layers: ["meshes"] }, { history: "push" });
  fireEvent.click(view.getByRole("button", { name: "Read detailed" }));
  await waitFor(() =>
    expect(io.call.mock.calls.some((call) => call[1]?.contextRepresentation === "meshes")).toBe(
      true,
    ),
  );
});

it("does not refit an uncommitted orbit when picture dimensions change", async () => {
  io.call.mockResolvedValue({ id: "resize-during-drag" });
  const view = mount("resize-during-drag");
  view.resize(640, 480);
  await act(async () => {});
  const orbit = io.orbit!;
  const gesture = orbit.begin();
  const next = { ...orbit.read()!, yaw: 140, zoom: 2 };
  act(() => orbit.preview(gesture, next));
  view.resize(320, 480);
  view.refresh(true);
  expect(orbit.owns(gesture)).toBe(true);
  expect(orbit.read()).toEqual(next);
});
