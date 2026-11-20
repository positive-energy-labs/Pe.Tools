// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { MARK_KINDS, type Finding } from "@pe/agent-contracts/slots";
import { z } from "zod";
import { field, route, paneLayout, picturePose, scrollBody, split } from "@pe/web-kernel/route";
import { subjectCode, uniqueIdSchema } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { AttentionRoot } from "@pe/web-kernel/attention";
import { ElementIndexContext, elementIndex } from "@pe/web-kernel/element-index";
import type { ModelPicture } from "#/scene/picture/model";
import { SceneMeshes } from "@pe/web-kernel/scene/types";
import { makeAtomRegistry } from "../../../shell/owner";
import type { PictureParts } from "@pe/web-kernel/route/slots/picture/overlay";
import { PicturePane } from "./pane.tsx";

/*
 * Slice 8's pane (routes MAP row 8; owner ruling 2026-11-11): a route that declares `picture` gets a
 * kernel-drawn pane. The kernel resolves the scope to the capture's focus, draws the declared marks
 * and the document's findings on captured geometry, and keeps the legend out of a small picture.
 * The renderer is the one fixture: `ModelPicture` records what the kernel `Picture` hands it.
 */
const io = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("#/scene/artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
const seen = vi.hoisted((): { model: Parameters<typeof ModelPicture>[0] | null } => ({ model: null }));
vi.mock("#/scene/picture/model", async (original) => ({
  ...(await original<typeof import("#/scene/picture/model")>()),
  ModelPicture: (props: Parameters<typeof ModelPicture>[0]) => { seen.model = props; return <div data-model-picture="" />; },
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); io.call.mockReset(); seen.model = null; });

const uid = uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72");
const pipe = subjectCode({ keyKind: "UniqueId", key: uid });
const port = subjectCode({ keyKind: "UniqueId", key: uid, sub: { port: 1 } });
const directory = { group: "Pods", summary: "See pipes", label: "Pipes", icon: "Boxes", exposure: "Main",
  surfaces: { web: "full", pwa: "full", tray: false }, aliases: [], runtimeNeed: "Revit", listed: true, satellites: [] } as const;
const main = { title: "Pipes", purpose: "List pipes", body: "scroll", draw: () => scrollBody(null) } as const;
const picture = {
  scope: { derive: () => ({ kind: "subjects" as const, refs: [pipe] }) },
  marks: () => [{ kind: "ring" as const, at: pipe, ink: "viz-2" }],
};
// A Pod's route, as both author specimens declare it: only `@pe/web/route` and a picture slot. The pose is the kernel's.
const pod = route({ key: "pod-pipes", name: "Pipes", directory, fields: {}, picture,
  panes: { main }, layout: split("h", ["main", "picture"], { id: "pipes", size: 320, sized: "start" }) });

test("a route that declares `picture` gets the kernel's picture pane; one it places itself is not added twice", () => {
  expect(pod.spec.panes).toHaveProperty("picture", expect.objectContaining({ kernel: "picture", body: "fill" }));
  expect(pod.data.panes).toHaveProperty("picture");
  expect(pod.data.picture).toEqual({ scope: "derived", marks: MARK_KINDS });
  // The route declared no pose: the kernel's pose fields are on its Page, so the pane it added can draw.
  expect(pod.spec.fields).toEqual(picturePose);
  expect(Object.keys(pod.data.fields)).toEqual(expect.arrayContaining(Object.keys(picturePose)));
  // A route's own field under a pose name is refused, never drawn as the pose.
  expect(() => route({ key: "pod-clash", name: "Pipes", directory, fields: { layers: field(z.string(), "", "query") }, picture,
    panes: { main }, layout: paneLayout("main") })).toThrow(/layers/);
  const placed = route({ key: "pod-placed", name: "Pipes", directory, fields: { ...picturePose }, picture,
    panes: { main, view: { title: "View", purpose: "See pipes", kernel: "picture", body: "fill", draw: main.draw as never } },
    layout: paneLayout("view") });
  expect(Object.keys(placed.spec.panes)).toEqual(["main", "view"]);
  // Both author specimens declare `picture` and leave it out of their layout: the pane is still the route's.
  const unplaced = route({ key: "pod-unplaced", name: "Pipes", directory, fields: {}, picture, panes: { main }, layout: paneLayout("main") });
  expect(unplaced.data.panes).toHaveProperty("picture");
  // No picture declared, no pane.
  expect(route({ key: "pod-plain", name: "Pipes", directory, fields: {}, panes: { main }, layout: paneLayout("main") }).spec.panes).not.toHaveProperty("picture");
});

const pose = Object.fromEntries(Object.entries(picturePose).map(([key, field]) => [key, field.initial]));
const meshes = new SceneMeshes(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 2]), { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 },
  [{ key: pipe, revitId: 101, documentKey: "host", linkInstanceId: null, uniqueId: uid, categoryId: null, category: "Pipes", focus: true, firstVertex: 0, vertexCount: 3 }]);
function mount(slot: Parameters<typeof PicturePane>[0]["ctx"]["slot"], findings: readonly Finding[] = [], layers: unknown = "default") {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target, contentRect: new DOMRectReadOnly(0, 0, 640, 480) } as ResizeObserverEntry], this as never); }
    unobserve() {}
    disconnect() {}
  });
  io.call.mockReturnValue(new Promise(() => {}));
  const draw = {
    target: { kind: "document", ref: { session: crypto.randomUUID(), openId: "doc" } },
    value: { state: "ready", value: {}, publication: { evaluation: "evaluation-1" } },
    page: { read: () => ({ ...pose, layers, selected: [] }), pose: vi.fn(), query: vi.fn(), select: vi.fn() },
    selection: { read: () => [], set: vi.fn() },
  };
  const view = render(
    <RegistryContext value={makeAtomRegistry()}>
      <ElementIndexContext value={elementIndex([{ elementId: 101, uniqueId: uid }])}>
        <AttentionRoot doc="d"><PicturePane ctx={{ draw: draw as never, slot, name: "Pipes", findings }} /></AttentionRoot>
      </ElementIndexContext>
    </RegistryContext>);
  return { ...view, draw };
}
const drawnMarks = (layer: string) =>
  seen.model!.drawn.find((l) => l.key === layer)?.draw({ meshes, paintOf: undefined }).map((l) => JSON.parse(l.key.slice(l.key.indexOf("{")))) ?? null;

test("the mounted pane captures the scope's elements and draws the declared marks on their captured geometry", async () => {
  mount(pod.spec.picture!);
  // The scope's SubjectRef is the capture's focus: the kernel builds the request, the route none.
  await waitFor(() => expect(JSON.stringify(io.call.mock.calls)).toContain('"elementIds":[101]'));
  expect(drawnMarks("marks")).toEqual([{ kind: "ring", at: { point: [1, 1, 1] }, ink: "viz-2" }]);
  // The pose is the kernel's: the picture reads the Page's own fields and writes them back through the Page.
  expect(seen.model!.contextMode).toBe("glass");
});

const said = { by: "human", at: "2026-11-11T12:00:00.000Z" } as const;
const finding: Finding = { id: "f1", subject: port, kind: "check", verdict: { ...said, value: "fail" }, text: "static reads low", said };
test("a finding on a port draws one mark on the port's element, under the `findings` layer", () => {
  mount(pod.spec.picture!, [finding]);
  expect(drawnMarks("findings")).toEqual([{ kind: "ring", at: { point: [1, 1, 1] } }]);
  cleanup();
  // The layer strip's `findings` toggle hides it: with the layer off the kernel hands the renderer no findings layer.
  mount(pod.spec.picture!, [finding], ["meshes"]);
  expect(seen.model!.drawn.map((l) => l.key)).not.toContain("findings");
});

test("the legend is a floater that folds with the field, never the pane's fixed legend over a small picture", () => {
  const parts: PictureParts = { lines: [], name: (key) => key, kinds: {}, colour: "mono", readout: { summary: "one pipe" },
    furniture: { legend: <span>health key</span> } };
  const { container } = mount({ ...picture, overlay: ({ picture: draw }) => draw(parts) });
  // kit lang.css: a pane field at most 28rem wide or 22rem tall folds every floater to a chip, except
  // `[data-slot="pane-legend"]`. The kernel pane offers the legend as an ordinary floater, so it folds too.
  expect(container.querySelector("[data-slot='pane-legend']")).toBeNull();
  expect(container.querySelector("[data-floater='legend']")?.textContent).toContain("health key");
});
