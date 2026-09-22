// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { JsonArray } from "#/lib/schema-to-field-render/array-field";
import { Press } from "#/components/lang/press";

afterEach(cleanup);

/** The real shape: a parent that owns the value and echoes every commit straight back. */
function Host({ initial, reset }: { initial: unknown; reset?: unknown }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <JsonArray label="tags" value={value} onChange={setValue} />
      {reset === undefined ? null : <Press onClick={() => setValue(reset)}>reset</Press>}
    </>
  );
}

const editor = () => screen.getByRole("textbox", { name: "tags as JSON" }) as HTMLTextAreaElement;

test("typing survives the parent echoing its own commit back", () => {
  render(<Host initial={[1]} />);
  // One line in, not the two-space-indented re-serialization the field would produce.
  fireEvent.change(editor(), { target: { value: "[1, 2]" } });
  expect(editor().value).toBe("[1, 2]");
  expect(screen.getByText("valid")).toBeTruthy();
});

test("text the field cannot accept stays on screen and says so", () => {
  render(<Host initial={[1]} />);
  fireEvent.change(editor(), { target: { value: "[1," } });
  expect(editor().value).toBe("[1,");
  expect(screen.getByText("invalid JSON")).toBeTruthy();
  // The bad text is held, not committed: fixing it commits and clears the word.
  fireEvent.change(editor(), { target: { value: "[1, 3]" } });
  expect(screen.getByText("valid")).toBeTruthy();
});

test("a change from outside replaces the text, even mid-edit", () => {
  render(<Host initial={[1]} reset={["a"]} />);
  fireEvent.change(editor(), { target: { value: "[1," } });
  fireEvent.click(screen.getByRole("button", { name: "reset" }));
  expect(editor().value).toBe('[\n  "a"\n]');
  expect(screen.getByText("valid")).toBeTruthy();
});
