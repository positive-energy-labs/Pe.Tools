// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { QueryCommand, QueryVocabulary } from "@pe/kit/table/model";
import { QueryBox } from "@pe/kit/table/query";
import { useTableState } from "@pe/kit/table/view";

afterEach(cleanup);

const VOCABULARY: QueryVocabulary = {
  fields: [{ label: "saved", kind: "number" }],
  rules: [],
  count: () => 3,
  values: () => [],
};

/** The caller's half: one state the chips and tokens derive from, the way a patch bay owns it. */
function Harness({ onCommit }: { onCommit: (said: string) => void }) {
  const [state, setState] = useTableState();
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [detach, setDetach] = useState(false);
  const command: QueryCommand = {
    armed,
    onArmed: setArmed,
    chips: [
      ...(target
        ? [{ key: "t", label: target, title: "target", onRemove: () => setTarget(null) }]
        : []),
      ...(detach
        ? [{ key: "d", label: "detach", title: "detach", onRemove: () => setDetach(false) }]
        : []),
    ],
    tokens: (typed) =>
      [
        ...(target
          ? []
          : ["2025", "2024", "new 2026"].map((year) => ({
              key: year,
              label: year,
              take: () => setTarget(year),
            }))),
        ...(detach ? [] : [{ key: "detach", label: "detach", take: () => setDetach(true) }]),
      ].filter((token) => token.label.startsWith(typed)),
    onCommit: () => onCommit(`${state.query}|${target}|${detach}`),
    says: "open",
  };
  return (
    <>
      <QueryBox
        vocabulary={VOCABULARY}
        state={state}
        onStateChange={setState}
        draft={draft}
        onDraft={setDraft}
        onInput={() => {}}
        command={command}
      />
      <output data-testid="state">{`${state.query}|${armed}|${target}|${detach}|${draft}`}</output>
    </>
  );
}

const box = () => screen.getByRole("combobox", { name: "table query" }) as HTMLInputElement;
const said = () => screen.getByTestId("state").textContent;
const typeInto = (text: string) => {
  for (let i = 1; i <= text.length; i++)
    fireEvent.change(box(), { target: { value: box().value + text[i - 1] } });
};

test("a typist reaches the command one character at a time, and Enter runs it", () => {
  const commit = vi.fn();
  render(<Harness onCommit={commit} />);
  box().focus();
  typeInto("tower");
  expect(said()).toBe("tower|false|null|false|tower");
  typeInto(" ->");
  // The arrow ends the query: "tower" is a chip, the command is armed, the box is empty.
  expect(said()).toBe("tower|true|null|false|");
  typeInto("2025 ");
  expect(said()).toBe("tower|true|2025|false|");
  typeInto("det");
  expect(said()).toBe("tower|true|2025|false|det");
  fireEvent.keyDown(box(), { key: "Tab" });
  expect(said()).toBe("tower|true|2025|true|");
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(commit).toHaveBeenCalledWith("tower|2025|true");
});

test("a paste lands whole: query, arrow, a two-word token and a trailing word", () => {
  const commit = vi.fn();
  render(<Harness onCommit={commit} />);
  box().focus();
  fireEvent.change(box(), { target: { value: "tower → new 2026 detach" } });
  // Every complete word went through its token; the last word waits for Enter or Tab.
  expect(said()).toBe("tower|true|new 2026|false|detach");
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(said()).toBe("tower|true|new 2026|true|");
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(commit).toHaveBeenCalledWith("tower|new 2026|true");
});

test("Backspace on an empty box pulls the last chip back as text, then drops the arrow", () => {
  render(<Harness onCommit={() => {}} />);
  box().focus();
  fireEvent.change(box(), { target: { value: "-> 2024 detach " } });
  expect(said()).toBe("|true|2024|true|");
  fireEvent.keyDown(box(), { key: "Backspace" });
  expect(said()).toBe("|true|2024|false|detach");
  fireEvent.change(box(), { target: { value: "" } });
  fireEvent.keyDown(box(), { key: "Backspace" });
  expect(said()).toBe("|true|null|false|2024");
  fireEvent.change(box(), { target: { value: "" } });
  fireEvent.keyDown(box(), { key: "Backspace" });
  expect(said()).toBe("|false|null|false|");
});

test("before the arrow the box behaves as ever: a field clause narrows and chips", () => {
  render(<Harness onCommit={() => {}} />);
  box().focus();
  fireEvent.change(box(), { target: { value: "saved>2023 " } });
  expect(said()).toBe("saved>2023|false|null|false|");
});
