// @vitest-environment jsdom
import * as Atom from "effect/unstable/reactivity/Atom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useWorkOwner, WorkContext } from "@pe/kit/lang/work";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { TestAttention } from "#/test-attention";
import { makeAtomRegistry } from "#/shell/owner";
import { SceneMeshes } from "../types";
import { Picture, type PictureContent } from "./picture";
import type { Scene3DProps } from "../scene3d";
import { ductsGraph } from "#/ducts/graph";
import { reduceLayout } from "../../../../../packages/kit/src/components/lang/layout-graph";
import type { LayoutNode } from "@pe/agent-contracts";

const io = vi.hoisted(() => ({ call: vi.fn() }));
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
  Scene3D: ({ meshes, readout }: Scene3DProps) => <div data-rendered={!!meshes}>{readout}</div>,
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
  focus: { walked: ["e:7311"], near: [] },
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
function mount(revision: string, refreshing = false) {
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
  const tree = (refresh: boolean, native = true) => (
    <TestAttention registry={registry}>
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
            selected: "",
            issue: "",
            encoding: "none",
            viewport: null,
            sceneView: { preset: "all", section: null },
            contextRadiusFt: 10,
            contextStyle: "glass",
            picture: "model",
            layers: ["meshes"],
          }}
          setPage={() => {}}
          renderPane={(body) => body}
          content={content}
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
  expect(io.call).toHaveBeenCalledTimes(1);
  view.resize(0, 0);
  await act(async () => {});
  expect(io.call.mock.calls[0]![2].signal.aborted).toBe(true);
  view.resize(640, 480);
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
  const layout = reduceLayout(ductsGraph.layout, (when) => when !== "sheet")!;
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
