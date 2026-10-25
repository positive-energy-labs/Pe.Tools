// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { DuctFinding } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { healPlan } from "@pe/ducts-domain/heal";
import { subjectDocument } from "@pe/kit/lang/subject-text";
import { inboxRows, annotatedFindings } from "./inbox-rows";
import { useMarks } from "./proto/e/rulings";
import { ElementMenu } from "#/revit/element-menu";
import { NativeObservationScope } from "#/revit/observation";
import { Annotations } from "./annotations";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { makeAtomRegistry } from "#/route/route-owner";
import { TestAttention } from "#/test-attention";
import { citation, cite, elementKey } from "@pe/kit/lang/attention";

vi.mock("@pe/kit/lib/token", () => ({
  token: () => "currentColor",
  tokenRef: () => "currentColor",
  dash: () => "none",
}));
afterEach(cleanup);

it("stub names are bold DOM captions and toggle independently of effective-length labels", () => {
  const registry = makeAtomRegistry();
  const props: Parameters<typeof Annotations>[0] = {
    project: (p) => [p[0]!, p[1]!],
    size: { width: 400, height: 300 },
    scene: { segments: [], nodes: [], subject: null } as unknown as Parameters<
      typeof Annotations
    >[0]["scene"],
    layers: new Set(["stub-labels"]),
    encoding: {} as Parameters<typeof Annotations>[0]["encoding"],
    selected: new Set(),
    hovered: null,
    rulings: [],
    issue: "",
    labels: [
      { key: "stub:1", at: [80, 60, 0], text: "SA 2", ids: [2], priced: false, stub: true },
      { key: "loss:1", at: [80, 100, 0], text: "Σ 31 eq ft", ids: [1], priced: true },
    ],
    pointOf: () => null,
    onPick() {},
    onFrame() {},
    onRuling() {},
  };
  const { container, rerender } = render(
    <TestAttention registry={registry}>
      <Annotations {...props} />
    </TestAttention>,
  );
  expect(container.querySelector("[data-stub-label] text")?.getAttribute("font-weight")).toBe(
    "bold",
  );
  expect(container.querySelector("[data-loss-label]")).toBeNull();
  rerender(
    <TestAttention registry={registry}>
      <Annotations {...props} layers={new Set(["labels"])} />
    </TestAttention>,
  );
  expect(container.querySelector("[data-stub-label]")).toBeNull();
  expect(container.querySelector("[data-loss-label]")?.textContent).toContain("Σ 31 eq ft");
});

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
  const registry = makeAtomRegistry();
  cite(registry, {
    owner: "row",
    refs: references.map(({ id, ...ref }) => ({ ...ref, doc: "test", key: elementKey(id) })),
    focus: null,
  });
  const go = vi.fn();
  const { container } = render(
    <TestAttention registry={registry}>
      <SubjectTextContext.Provider value={{ doc: "test", nameOf: () => null, go }}>
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
      </SubjectTextContext.Provider>
    </TestAttention>,
  );
  const badges = [...container.querySelectorAll("[data-subject-badge]")];
  // 1 has a mesh; 2 is a meshless centreline in the scene (drawn as a ghost); 3 is not drawn at all.
  expect(badges.map((b) => b.getAttribute("data-footnote"))).toEqual(["1", "2"]);
  expect(badges[0]!.querySelector("path")).toBeNull();
  expect(badges[1]!.querySelector("path")).not.toBeNull();
  const mark = badges[1]!.querySelector(".subject-badge")!;
  fireEvent.mouseEnter(mark);
  expect(registry.get(citation)?.focus).toEqual({ doc: "test", key: "e:2" });
  fireEvent.click(mark);
  expect(go).toHaveBeenCalledWith(2);
});

it("one gap repair has one row, two named subjects, two pins and one evidence sentence", () => {
  const segments = [10, 11].map((id, i) => ({
    id,
    kind: "duct",
    groupId: `g${id}`,
    systemName: "SA 1",
    classification: "SupplyAir",
    size: "10x7",
    polyline: [
      [i * 11.25, 0, 0],
      [i * 11.25 + 10, 0, 0],
    ],
    connectors: [
      {
        index: 0,
        kind: "end",
        point: [10 + i * 1.25, 0, 0],
        shape: "rectangular",
        widthIn: 10,
        heightIn: 7,
        connectedTo: null,
      },
    ],
  }));
  const issues = segments.map((e) => ({
    id: `open-end:${e.groupId}:${e.id}:0`,
    kind: "open-end",
    elementId: e.id,
    groupId: e.groupId,
    point: e.connectors[0]!.point,
    note: "open",
  }));
  const snapshot = {
    nodes: [],
    segments,
    issues,
    groups: [],
  } as unknown as DuctSnapshot;
  const findings = issues.map((i) => ({
    id: i.id,
    kind: "open-end",
    elementIds: [i.elementId],
    groupId: i.groupId,
    note: i.note,
    assumed: null,
    clearer: "person",
  })) as DuctFinding[];
  findings.push({
    ...findings[0]!,
    id: "missed-join:10:0|11:0",
    kind: "missed-join",
    elementIds: [10, 11],
  });
  const heal = healPlan(snapshot);
  expect(heal.hard.size).toBe(1);
  const input = {
    snapshot,
    scope: null,
    findings,
    heal,
    nameOf: () => "10x7 duct",
    flows: new Map(),
    equipmentFlows: new Map(),
    doc: null,
    claims: [],
    write: { staged: 0, hasPreview: false, fresh: false, planned: null, refused: null, esp: 0 },
  };
  const rows = inboxRows(input);
  expect(rows.fix).toHaveLength(1);
  const row = rows.fix[0]!;
  expect(row.key).toBe("proximity:10:0|11:0");
  expect(row.title).toBe("Open ends at 10x7 duct and 10x7 duct");
  const heading = subjectDocument(row.titleParts!, input.nameOf);
  expect(heading.references.map((r) => [r.name, r.number])).toEqual([
    ["10x7 duct", 1],
    ["10x7 duct", 2],
  ]);
  expect(row.note?.match(/15.0 in apart/g)).toHaveLength(1);
  const { result } = renderHook(() =>
    useMarks({
      snapshot,
      priced: { findings, next: { paths: {} } } as never,
      scene: { segments: segments.map((segment) => ({ segment })), nodes: [] } as never,
      claims: [],
      work: { doc: null } as never,
      issueScope: null,
      annotated: annotatedFindings(rows, heal, ""),
      pointOf: () => null,
    }),
  );
  expect(result.current.rulings.map((r) => [r.at, r.n])).toEqual([
    [10, 1],
    [11, 1],
  ]);
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
