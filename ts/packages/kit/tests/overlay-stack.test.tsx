// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createPortal } from "react-dom";
import { useState } from "react";
import {
  Popover,
  SubjectPopoverContent as PopoverContent,
  PopoverTrigger,
} from "../src/components/lang/popover";
afterEach(cleanup);

/** A route portals its section into the chrome popover's DOM, outside the popover's React tree. */
function Chrome() {
  const [outlet, setOutlet] = useState<HTMLElement | null>(null);
  return (
    <>
      <Popover>
        <PopoverTrigger>Settings</PopoverTrigger>
        <PopoverContent aria-label="Settings menu">
          <span>theme</span>
          <div ref={setOutlet} />
        </PopoverContent>
      </Popover>
      {outlet
        ? createPortal(
            <Popover>
              <PopoverTrigger>slot</PopoverTrigger>
              <PopoverContent aria-label="slot list">
                <button>Flow</button>
              </PopoverContent>
            </Popover>,
            outlet,
          )
        : null}
    </>
  );
}

test("a popover opened from inside another's popup stacks on it instead of replacing it", async () => {
  render(<Chrome />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByText("theme")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "slot" }));
  const row = await screen.findByRole("button", { name: "Flow" });
  // Both popups are open; the parent stayed.
  expect(screen.getByText("theme")).toBeTruthy();
  // A press inside the child's popup is inside the parent too.
  fireEvent.pointerDown(row);
  fireEvent.mouseDown(row);
  fireEvent.click(row);
  expect(screen.getByText("theme")).toBeTruthy();
  // Escape closes the child only, then the parent.
  fireEvent.keyDown(row, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("Flow")).toBeNull());
  expect(screen.getByText("theme")).toBeTruthy();
  fireEvent.keyDown(screen.getByText("theme"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("theme")).toBeNull());
});

test("a sibling popover still replaces the open one", async () => {
  render(
    <>
      <Popover>
        <PopoverTrigger>A</PopoverTrigger>
        <PopoverContent>first</PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger>B</PopoverTrigger>
        <PopoverContent>second</PopoverContent>
      </Popover>
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "A" }));
  expect(await screen.findByText("first")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "B" }));
  expect(await screen.findByText("second")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("first")).toBeNull());
});
