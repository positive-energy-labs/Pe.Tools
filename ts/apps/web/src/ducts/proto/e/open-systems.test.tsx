// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { OpenSystems } from "./open-systems";

afterEach(cleanup);
test("open pills retain order, close independently, activate the previous system and clear to the document", () => {
  function Harness() {
    const [system, onChange] = useState(["SA Office", "EA Lab"]);
    return <OpenSystems system={system} onChange={onChange} />;
  }
  const { container } = render(<Harness />);
  expect(
    [...container.querySelectorAll("span[data-surface='artifact']")].map((e) => e.textContent),
  ).toEqual(["SA Office", "EA Lab active"]);
  expect(container.querySelector("[data-selected]")?.textContent).toBe("EA Lab active");
  fireEvent.click(screen.getByRole("button", { name: 'Remove the "EA Lab active" narrowing' }));
  expect(container.querySelector("[data-selected]")?.textContent).toBe("SA Office active");
  fireEvent.click(screen.getByRole("button", { name: "Clear all open systems" }));
  expect(screen.getByText("Whole document")).toBeTruthy();
  expect(container.querySelector("[data-selected]")).toBeNull();
});
