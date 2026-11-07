// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SceneMeshes } from "../scene/types";
import type { Scene3DProps } from "../scene/scene3d";
import { TestAttention } from "../test-attention";
import { makeAtomRegistry } from "../shell/owner";
import { mountTypedRoute } from "../shell/typed-mount";
import { route, localId } from "./typed-route";
import { module as fans } from "../fans/route";
import { PictureBody } from "../ducts/sheet/mount";
import { workFingerprintSchema } from "@pe/agent-contracts";
const io = vi.hoisted(() => ({ call: vi.fn(), orbit: null as Scene3DProps["orbit"] | null }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("../scene/artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
vi.mock("../scene/psc1", () => ({
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
vi.mock("../scene/scene3d", () => ({
  Scene3D: ({ meshes, readout, orbit }: Scene3DProps) => {
    io.orbit = orbit;
    return <div data-rendered={!!meshes}>{readout}</div>;
  },
}));


const observers = new Map<Element, ResizeObserverCallback>();
afterEach(() => { cleanup(); observers.clear(); io.call.mockReset(); vi.unstubAllGlobals(); });

test("JZ H04 typed Fans picture demands exact elements and reach, refuses document-only detail and replaces document authority", async () => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.set(element, this.callback); }
    disconnect() {}
  });
  io.call.mockImplementation(() => new Promise(() => {}));
  const spec = route({ ...fans.spec, edits: undefined });
  const registry = makeAtomRegistry();
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const open = (openId: string, empty = false) => {
    const mount = mountTypedRoute(spec, {
      target: { kind: "document", ref: { session: "h04", openId } }, fixture: null,
      work: { address: null, open: null },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      custody: { current: () => true }, memory: () => ({}),
    }, stamp, { sources: { "fans.sheet": { kind: "use", open(ctx, deliver) {
      const packet = structuredClone(fans.spec.core!.source.provide!("layout", ctx.args));
      const data = packet.value!.data as any;
      data.sheetSnapshot.sourceVersion = `h04-${openId}`;
      if (empty) { data.sheetSnapshot.nodes = []; data.sheetSnapshot.segments = []; data.open = null; data.opened = []; data.rows = []; data.fans.rows = []; }
      deliver({ kind: "complete", value: packet, revision: 1 });
    } } } });
    mounts.push(mount); mount.subscribe(() => {}); mount.page.subject({ kind: "ids", ids: [localId("ducts-fan", "9cb9f188-28aa-4094-8b76-785395cc35e1-00000001@2")] });
    return mount;
  };
  const tree = (mount: ReturnType<typeof open>) => <TestAttention registry={registry}>{mount.draw("sheet-picture", ctx => <PictureBody ctx={ctx as any} />) as React.ReactNode}</TestAttention>;
  const resize = () => act(() => { for (const [target, callback] of observers) callback([{ target, contentRect: { width: 640, height: 480 } } as ResizeObserverEntry], {} as ResizeObserver); });
  try {
    const a = open("a");
    await waitFor(() => expect(a.value(), JSON.stringify(a.value())).toMatchObject({current:true}));
    const view = render(tree(a)); resize();
    await waitFor(() => expect(io.call).toHaveBeenCalled());
    expect(io.call.mock.calls.every(([, req]) => req.contextRepresentation === "overview"), "H04: mount acquires no detailed geometry").toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Read detailed" }));
    await waitFor(() => expect(io.call.mock.calls.some(([, req]) => req.contextRepresentation === "meshes")).toBe(true));
    const detail = io.call.mock.calls.find(([, req]) => req.contextRepresentation === "meshes")!;
    const sheet = (a.value().value as any).open;
    const layers = a.page.read().layers;
    const context = layers === "all" || layers.includes("context") || layers.includes("halo");
    const expected = [...new Set<number>([sheet.overview.fan.unitId, ...sheet.elements.walkedElementIds,
      ...(context ? sheet.elements.beyond.flatMap((unit: { elementIds: number[] }) => unit.elementIds) : []),
    ])].sort((x, y) => x - y);
    expect(detail[1].elementIds, "H04: detail names only the opened walk and declared neighbours").toEqual(expected);
    expect(detail[1]).toMatchObject({ contextPaddingFt: 10, focusOnly: false });
    expect(detail[2]).toMatchObject({ bridgeSessionId: "h04", openDocumentId: "a" });
    const b = open("b"); await waitFor(() => expect(b.value().current).toBe(true));
    view.rerender(tree(b)); resize();
    await waitFor(() => expect(detail[2].signal.aborted).toBe(true));
    const count = io.call.mock.calls.length;
    expect(io.call.mock.calls.filter(([, , options]) => options.openDocumentId === "b").every(([, req]) => req.contextRepresentation === "overview")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Read detailed" }));
    await waitFor(() => expect(io.call.mock.calls.length).toBeGreaterThan(count));
    expect(io.call.mock.calls.at(-1)![2]).toMatchObject({ bridgeSessionId: "h04", openDocumentId: "b" });
    expect(io.call.mock.calls.at(-1)![1].contextRepresentation).toBe("meshes");
    const empty = open("empty", true); await waitFor(() => expect(empty.value().current).toBe(true));
    view.rerender(tree(empty)); resize();
    const before = io.call.mock.calls.length;
    expect(view.queryByRole("button", { name: "Read detailed" }), "H04: no element scope offers no detail action").toBeNull();
    await act(async () => {});
    expect(io.call.mock.calls.length, "H04: a document without elements never authorizes detail").toBe(before);
  } finally { cleanup(); mounts.forEach(m => m.dispose()); registry.dispose(); }
});
