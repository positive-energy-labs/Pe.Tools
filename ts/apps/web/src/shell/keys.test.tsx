// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { KeyScope, ScopeKeys } from "@pe/kit/keys";
import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import { z } from "zod";
import {
  bindGraphChords,
  chordIgnoresInputs,
  validateGraphChords,
  type GraphChordPlacements,
} from "./keys";

function fixture() {
  const graph: RouteGraph = {
    key: "keys-proof",
    address: "/keys-proof",
    name: "Keys proof",
    fields: {},
    readings: {},
    verbs: {
      apply: {
        kind: "command",
        input: z.object({}),
        review: "none",
        label: "Apply",
        chord: "Mod+Enter",
      },
      edit: { kind: "work", input: z.object({}), review: "none", label: "Edit", chord: "E" },
      toggle: { kind: "work", input: z.object({}), review: "none", label: "Toggle" },
      other: { kind: "work", input: z.object({}), review: "none", label: "Other", chord: "O" },
    },
    panes: {
      table: {
        label: "Table",
        purpose: "Edit",
        draws: [],
        verbs: ["edit", "toggle"],
        chords: { toggle: "Alt+T" },
      },
      picture: { label: "Picture", purpose: "View", draws: [], verbs: ["other"] },
    },
    stages: {
      edit: { word: "Edit", panes: ["table", "picture"], verbs: ["apply"] },
      inspect: { word: "Inspect", panes: ["picture"], verbs: [] },
    },
    layout: split("body", { axis: "h", sized: "start", size: 300 }, pane("table"), pane("picture")),
  };
  const placements: GraphChordPlacements = {
    panes: { table: {}, picture: {} },
    actions: {
      apply: { invoke: vi.fn() },
      edit: { invoke: vi.fn() },
      toggle: { invoke: vi.fn() },
      other: { invoke: vi.fn() },
    },
  };
  return { graph, placements };
}

test("verb placements project route, stage and pane scopes using kit ScopeKeys", () => {
  const { graph, placements } = fixture();
  const result = bindGraphChords(graph, "edit", placements);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("Expected scope tree");
  expect(result.tree.id).toBe(graph.key);
  expect(result.tree.keys).toEqual([]);
  const stage = result.tree.children[0]!;
  expect(stage.id).toBe("keys-proof:edit");
  expect(stage.keys.map(({ hotkey }) => hotkey)).toEqual(["Mod+Enter"]);
  expect(stage.keys[0]?.options?.ignoreInputs).toBe(false);
  expect(
    stage.children.map(({ id, keys }) => [
      id,
      keys.map(({ hotkey, options }) => [hotkey, options?.ignoreInputs]),
    ]),
  ).toEqual([
    [
      "table",
      [
        ["E", true],
        ["Alt+T", false],
      ],
    ],
    ["picture", [["O", true]]],
  ]);
  const preventDefault = vi.fn();
  const event = { preventDefault } as unknown as KeyboardEvent;
  stage.children[0]!.keys[0]!.callback(event, {} as never);
  expect(placements.actions.edit!.invoke).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
});

test("off-stage, absent and folded panes bind nothing", () => {
  const { graph, placements } = fixture();
  const cases: GraphChordPlacements["panes"][] = [{}, { table: { folded: true } }];
  for (const panes of cases) {
    const result = bindGraphChords(graph, "edit", { ...placements, panes });
    expect(result.ok && result.tree.children[0]!.children).toEqual([]);
  }
  const result = bindGraphChords(graph, "inspect", placements);
  expect(result.ok && result.tree.children[0]!.keys).toEqual([]);
  expect(result.ok && result.tree.children[0]!.children.map(({ id }) => id)).toEqual(["picture"]);
});

test("stage chord maps are never another source of bindings", () => {
  const { graph, placements } = fixture();
  graph.stages.edit!.chords = { toggle: "Mod+T" };
  const result = bindGraphChords(graph, "edit", placements);
  expect(result.ok && result.tree.children[0]!.keys.map(({ hotkey }) => hotkey)).toEqual([
    "Mod+Enter",
  ]);
});

test.each([
  ["E", true],
  ["Shift+E", true],
  ["Escape", true],
  ["Mod+Enter", false],
  ["Alt+T", false],
  ["Ctrl+E", false],
])("%s derives ignoreInputs=%s", (chord, expected) => {
  expect(chordIgnoresInputs(chord)).toBe(expected);
});

test.each([
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+Y",
  "Mod+K",
  "Mod+Shift+K",
  " shift + mod + k ",
  "Ctrl+Z",
  "Command+Shift+K",
])("reserved %s refuses even in an inactive declaration", (chord) => {
  const { graph, placements } = fixture();
  graph.verbs.other!.chord = chord;
  const result = bindGraphChords(graph, "edit", { ...placements, panes: {} });
  expect(result).toMatchObject({
    ok: false,
    refusals: [{ code: "reserved-chord", path: "verbs.other.chord" }],
  });
});

test("pane chord maps also refuse reserved chords and collisions before mount", () => {
  const { graph, placements } = fixture();
  graph.panes.table!.chords = { toggle: "Mod+K" };
  expect(validateGraphChords(graph)).toMatchObject([{ code: "reserved-chord" }]);
  graph.panes.table!.chords = { toggle: " e " };
  expect(bindGraphChords(graph, "edit", placements)).toMatchObject({
    ok: false,
    refusals: [{ code: "chord-conflict", path: "panes.table.chords" }],
  });
  graph.panes.table!.chords = {};
  graph.verbs.other!.chord = "E";
  expect(validateGraphChords(graph)).toEqual([]); // Sibling scopes may use the same chord.
});

test("one verb can move from pane to stage without a second chord declaration", () => {
  const { graph, placements } = fixture();
  graph.stages.edit!.verbs = ["edit"];
  graph.panes.table!.verbs = ["toggle"];
  const result = bindGraphChords(graph, "edit", placements);
  expect(result.ok && result.tree.children[0]!.keys.map(({ hotkey }) => hotkey)).toEqual(["E"]);
  expect(
    result.ok && result.tree.children[0]!.children[0]!.keys.map(({ hotkey }) => hotkey),
  ).toEqual(["Alt+T"]);
});

test("dynamic panes bind only resolved declared verbs and refuse undeclared ids", () => {
  const { graph, placements } = fixture();
  const resolve = Object.assign(() => ["edit"], { ids: ["edit", "toggle"] });
  graph.panes.table!.verbs = resolve;
  const result = bindGraphChords(graph, "edit", {
    ...placements,
    panes: { table: { verbs: ["edit"] } },
  });
  expect(
    result.ok && result.tree.children[0]!.children[0]!.keys.map(({ hotkey }) => hotkey),
  ).toEqual(["E"]);
  expect(
    bindGraphChords(graph, "edit", { ...placements, panes: { table: { verbs: ["other"] } } }),
  ).toMatchObject({ ok: false, refusals: [{ code: "missing-verb" }] });
});

test("kit invocation gate retains the verb owner's refusal and availability", () => {
  const { graph, placements } = fixture();
  placements.actions.edit!.refusal = "Select a row";
  const result = bindGraphChords(graph, "edit", placements);
  if (!result.ok) throw Error("Expected scope tree");
  const key = result.tree.children[0]!.children[0]!.keys[0]!;
  expect(key.refusal).toBe("Select a row");
  key.callback({ preventDefault: vi.fn() } as unknown as KeyboardEvent, {} as never);
  expect(placements.actions.edit!.invoke).not.toHaveBeenCalled();
});

test("real kit scope bindings leave bare letters to inputs, allow Mod commands there, and route to the innermost pane", () => {
  const { graph, placements } = fixture();
  graph.verbs.other!.chord = "E";
  graph.stages.edit!.verbs = ["apply", "other"];
  graph.stages.edit!.panes = ["table"];
  const result = bindGraphChords(graph, "edit", placements);
  if (!result.ok) throw Error("Expected scope tree");
  const stage = result.tree.children[0]!;
  const paneScope = stage.children[0]!;
  const element = createRef<HTMLDivElement>();
  const mounted = render(
    <KeyScope id={result.tree.id}>
      <KeyScope id={stage.id}>
        <ScopeKeys keys={stage.keys} />
        <div ref={element} tabIndex={0}>
          <KeyScope id={paneScope.id} element={element}>
            <ScopeKeys keys={paneScope.keys} />
            <input aria-label="Edit text" />
          </KeyScope>
        </div>
        <button>Outside pane</button>
      </KeyScope>
    </KeyScope>,
  );
  const input = mounted.getByRole("textbox");
  input.focus();
  fireEvent.keyDown(input, { key: "e", code: "KeyE" });
  expect(placements.actions.edit!.invoke).not.toHaveBeenCalled();
  expect(placements.actions.other!.invoke).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", code: "Enter", ctrlKey: true });
  expect(placements.actions.apply!.invoke).toHaveBeenCalledOnce();
  element.current!.focus();
  fireEvent.keyDown(element.current!, { key: "e", code: "KeyE" });
  expect(placements.actions.edit!.invoke).toHaveBeenCalledOnce();
  expect(placements.actions.other!.invoke).not.toHaveBeenCalled();
  const outside = mounted.getByRole("button");
  outside.focus();
  fireEvent.keyDown(outside, { key: "e", code: "KeyE" });
  expect(placements.actions.other!.invoke).toHaveBeenCalledOnce();
  mounted.unmount();
});
