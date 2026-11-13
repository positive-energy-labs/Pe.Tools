// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { actionScopeKeys, KeyScope, ScopeKeys } from "@pe/kit/keys";
import { chordIgnoresInputs, validateGraphChords } from "./keys";
import { ductLossGraph } from "./projection-graph.test.fixture";
import { z } from "zod";

test.each(["Mod+Z", "Control+Z", "Command+K"])("%s remains reserved without the dead binder", chord => {
  // Mutant: remove the reserved-chord admission check with bindGraphChords.
  const graph = { ...ductLossGraph, panes: {
    probe: { label: "Probe", purpose: "Reservation", draws: [], verbs: [], chords: { probe: chord } },
  } };
  expect(validateGraphChords(graph)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "reserved-chord", path: "panes.probe.chords.probe" }),
  ]));
});

test.each(["Alt+/", "Option+/", "Mod+Shift+.", "Ctrl+Shift+.", "Command+Shift+Period"] as const)(
  "shell reserves %s before any route binds it", (chord) => {
    expect(validateGraphChords({ verbs: { help: { kind: "query", review: "none", label: "Help", chord, effect: "query", input: z.object({}) } }, panes: {} }))
      .toMatchObject([{ code: "reserved-chord", path: "verbs.help.chord" }]);
  },
);

test.each([["E", true], ["Shift+E", true], ["Mod+Enter", false], ["Alt+T", false]] as const)(
  "%s leaves text inputs alone = %s", (chord, ignores) => {
    expect(chordIgnoresInputs(chord)).toBe(ignores);
  },
);

test("real kit scope bindings leave bare letters to inputs, allow Mod commands there, and route to the innermost pane", () => {
  const placements = { actions: { edit: { invoke: vi.fn() }, apply: { invoke: vi.fn() },
    other: { invoke: vi.fn() } } };
  const stage = { id: "stage", keys: actionScopeKeys([
    { id: "apply", label: "Apply", bindings: ["Mod+Enter"],
      options: { ignoreInputs: chordIgnoresInputs("Mod+Enter") }, invoke: placements.actions.apply.invoke },
    { id: "other", label: "Other", bindings: ["E"],
      options: { ignoreInputs: chordIgnoresInputs("E") }, invoke: placements.actions.other.invoke },
  ]) };
  const paneScope = { id: "pane", keys: actionScopeKeys([
    { id: "edit", label: "Edit", bindings: ["E"],
      options: { ignoreInputs: chordIgnoresInputs("E") }, invoke: placements.actions.edit.invoke },
  ]) };
  const element = createRef<HTMLDivElement>();
  const mounted = render(
    <KeyScope id="route">
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
