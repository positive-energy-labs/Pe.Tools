// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NamePicker } from "./readout-primitives";

afterEach(cleanup);

test("typing a category prefix and pressing Enter picks the first match", async () => {
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
  // The trigger opens the list; its search owns typing, and Enter picks the top hit (R5, R14).
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "draft categories" })));
  const search = await screen.findByLabelText("draft categories search");
  await act(async () => fireEvent.change(search, { target: { value: "Sprink" } }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  expect(onChange).toHaveBeenCalledWith(["Sprinkler Tags"]);
});
