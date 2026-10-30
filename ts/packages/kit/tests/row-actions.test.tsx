// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useState } from "react";
import { Row } from "../src/components/lang/row";
import { Button } from "../src/components/lang/button";

afterEach(cleanup);

test("a collapsed row's action owns pointer and keyboard presses without toggling", () => {
  const action = vi.fn();
  const pointer = vi.fn();
  function Fixture() {
    const [expanded, setExpanded] = useState(false);
    return (
      <div
        onPointerDown={() => {
          pointer();
          setExpanded(!expanded);
        }}
      >
        <Row
          label="Heal network"
          role="button"
          tabIndex={0}
          depth={0}
          expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpanded(!expanded);
            }
          }}
          actions={
            <Button label="Preview heal" onPress={action}>
              Preview heal
            </Button>
          }
        />
      </div>
    );
  }
  render(<Fixture />);
  const row = screen.getByRole("button", { name: /Heal network/ });
  const button = screen.getByRole("button", { name: "Preview heal" });
  fireEvent.pointerDown(button);
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(action).toHaveBeenCalledTimes(1);
  expect(pointer).not.toHaveBeenCalled();
  expect(row.getAttribute("aria-expanded")).toBe("false");
  for (const key of ["Enter", " "]) {
    expect(fireEvent.keyDown(button, { key })).toBe(true);
    fireEvent.keyUp(button, { key });
    // jsdom does not synthesize the native button click from keyboard events.
    fireEvent.click(button);
    expect(row.getAttribute("aria-expanded")).toBe("false");
  }
  expect(action).toHaveBeenCalledTimes(3);
  fireEvent.keyDown(row, { key: "Enter" });
  expect(row.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(row, { key: " " });
  expect(row.getAttribute("aria-expanded")).toBe("false");
});
