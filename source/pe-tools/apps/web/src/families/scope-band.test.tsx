// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NamePicker } from "./readout-primitives";

afterEach(cleanup);

test("typing a category prefix and pressing Enter commits the first match as a chip", async () => {
  const onChange = vi.fn();
  render(
    <NamePicker
      options={["Ducts", "Sprinkler Tags", "Sprinklers"]}
      values={[]}
      onChange={onChange}
      placeholder="add categories…"
      ariaLabel="draft categories"
      title="draft"
    />,
  );
  const input = screen.getByRole("combobox", { name: "draft categories" });
  await act(async () => {
    input.focus();
    // A real keystroke carries `inputType`; without it the combobox reads autofill and stays shut.
    fireEvent.input(input, { target: { value: "Sprink" }, inputType: "insertText" });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(screen.queryAllByRole("option")).toEqual([]);
  expect(onChange).toHaveBeenCalledWith(["Sprinkler Tags"]);
});
