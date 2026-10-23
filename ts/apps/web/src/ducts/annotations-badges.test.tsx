// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ElementMenu } from "#/revit/element-menu";
import { NativeObservationScope } from "#/revit/observation";
import { Annotations } from "./annotations";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { reachStore } from "@pe/kit/lang/reach";

vi.mock("@pe/kit/lib/token", () => ({
  token: () => "currentColor",
  tokenRef: () => "currentColor",
  dash: () => "none",
}));
afterEach(cleanup);

it("a footnote badge sits on a drawn subject (mesh, else ghosted centreline, else none); hover lights its token, press goes", () => {
  const segment = {
    id: 2,
    polyline: [
      [0, 0, 0],
      [10, 0, 0],
    ],
  };
  const points: Record<number, number[]> = { 1: [5, 5, 0], 2: [5, 0, 0], 3: [9, 9, 0] };
  const encoding = { bins: [{ stroke: { ink: "currentColor", width: 1 } }], bin: () => 0 };
  const references = [1, 2, 3].map((id) => ({ id, name: `E${id}`, number: id }));
  const reach = reachStore();
  reach.set((state) => ({
    ...state,
    lighting: { ids: new Set([1, 2, 3]), references, focus: null, owner: "row" },
  }));
  const light = vi.fn();
  const go = vi.fn();
  const { container } = render(
    <SubjectTextContext.Provider value={{ nameOf: () => null, reach, light, clear: () => {}, go }}>
      <Annotations
        {...({
          project: (p: readonly number[]) => [p[0]! * 10 + 50, p[1]! * 10 + 50],
          size: { width: 400, height: 300 },
          scene: { segments: [{ segment }], nodes: [], subject: null },
          layers: new Set(),
          encoding,
          selected: new Set(),
          hovered: null,
          labels: [],
          meshed: new Set([1]),
          rulings: [],
          issue: "",
          pointOf: (id: number) => points[id] ?? null,
          onPick() {},
          onFrame() {},
          onRuling() {},
          onHover() {},
        } as unknown as Parameters<typeof Annotations>[0])}
      />
    </SubjectTextContext.Provider>,
  );
  const badges = [...container.querySelectorAll("[data-subject-badge]")];
  // 1 has a mesh; 2 is a meshless centreline in the scene (drawn as a ghost); 3 is not drawn at all.
  expect(badges.map((b) => b.getAttribute("data-footnote"))).toEqual(["1", "2"]);
  expect(badges[0]!.querySelector("path")).toBeNull();
  expect(badges[1]!.querySelector("path")).not.toBeNull();
  const mark = badges[1]!.querySelector(".subject-badge")!;
  fireEvent.mouseEnter(mark);
  expect(light).toHaveBeenLastCalledWith(references, 2, "row");
  fireEvent.click(mark);
  expect(go).toHaveBeenCalledWith(2);
});

it("pin pointer entry paints reach and right click exposes Select and Selection Box", async () => {
  const pick = vi.fn();
  const props = {
    project: () => [100, 100],
    size: { width: 400, height: 300 },
    scene: { segments: [], nodes: [], subject: null },
    layers: new Set(["findings"]),
    encoding: {},
    selected: new Set(),
    hovered: null,
    labels: [],
    rulings: [{ kind: "issue", n: 1, at: 42, issue: { id: "open", kind: "open-end" } }],
    issue: "",
    pointOf: () => [0, 0, 0],
    onPick() {},
    onFrame() {},
    onRuling: pick,
    onHover() {},
  };
  const view = render(
    <NativeObservationScope
      value={{
        scope: { document: { session: "s", openId: "o" }, source: "native" },
        references: [{ elementId: 42, uniqueId: "captured" }],
      }}
    >
      <ElementMenu />
      <Annotations {...(props as unknown as Parameters<typeof Annotations>[0])} />
    </NativeObservationScope>,
  );
  const pin = view.container.querySelector("[data-ruling-pin='1']")!;
  expect(pin.getAttribute("data-revit-refs")).toContain("captured");
  fireEvent.pointerEnter(pin);
  expect(pin.getAttribute("data-reach")).toBe("hover");
  fireEvent.click(pin);
  expect(pick).toHaveBeenCalledOnce();
  fireEvent.contextMenu(pin);
  expect(await view.findByRole("option", { name: "Select" })).toBeTruthy();
  expect(view.getByRole("option", { name: "Selection Box in Revit" })).toBeTruthy();
  expect(view.queryByRole("menu")).toBeNull();
});
